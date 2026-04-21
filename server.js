const WebSocket = require('ws');
const http = require("http");
const fs = require('fs');
const path = require("path");

// 🔹 serveur HTTP basique
const server = http.createServer((req, res) => {

    let filePath = "./public" + (req.url === "/" ? "/admin.html" : req.url);

    let ext = path.extname(filePath);

    let contentType = "text/html";

    if (ext === ".js") contentType = "text/javascript";
    if (ext === ".css") contentType = "text/css";

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end("404 Not Found");
        } else {
            res.writeHead(200, { "Content-Type": contentType });
            res.end(content);
        }
    });
});

// 🔹 attacher WebSocket au serveur HTTP
const wss = new WebSocket.Server({ server });

let clients = {};
let admins = [];

const FILE = "../conversations.json";


function ensureClient(id, name = "") {
    if (!conversations[id]) {
        conversations[id] = {
            name: name || ("Client " + id.split(":").pop()),
            messages: [],
            unread: 0
        };
    }

    // migration ancien format
    if (Array.isArray(conversations[id])) {
        conversations[id] = {
            name: "Client " + id.split(":").pop(),
            messages: conversations[id],
            unread: 0
        };
    }

    if (!conversations[id].name) {
        conversations[id].name = "Client " + id.split(":").pop();
    }
}

// =============================
// 📂 CHARGER CONVERSATIONS
// =============================
let conversations = {};

if (fs.existsSync(FILE)) {
    try {
        conversations = JSON.parse(fs.readFileSync(FILE));
        console.log("📂 Conversations chargées");
    } catch (e) {
        console.log("❌ Erreur lecture JSON");
    }
}

nettoyer(); // 🔥 nettoyage immédiat au lancement

// =============================
// 💾 SAUVEGARDE
// =============================
function save() {
    fs.writeFileSync(FILE, JSON.stringify(conversations, null, 2));
}

// =============================
// 🧹 SUPPRESSION (24h)
// =============================
function nettoyer() {
    let now = Date.now();

    for (let id in conversations) {

        ensureClient(id);

        let msgs = conversations[id].messages;

        if (msgs.length === 0) {
            delete conversations[id];
            continue;
        }

        let lastMsg = msgs[msgs.length - 1];

        if (!lastMsg || !lastMsg.time) continue;

        // supprimer si +24h
        if ((now - lastMsg.time) > (24 * 60 * 60 * 1000)) {
            delete conversations[id];
            console.log("🗑️ Conversation supprimée:", id);
        }
    }

    save();
}

function sendToAdmins(payload) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.isAdmin) {
            client.send(JSON.stringify(payload));
        }
    });
}

// toutes les 10 minutes
setInterval(nettoyer, 10 * 60 * 1000);

// =============================
// 🔌 CONNEXION
// =============================
wss.on('connection', (ws) => {
    console.log("🔌 Nouvelle connexion");

    // 🔥 heartbeat
    ws.isAlive = true;

    ws.on('pong', () => {
        ws.isAlive = true;
    });

    // =========================
    // 📩 MESSAGE
    // =========================
    ws.on('message', (msg) => {
        let data;

        try {
            data = JSON.parse(msg);
        } catch {
            console.log("❌ JSON invalide");
            return;
        }
        

        // =========================
        // CLIENT CONNECT
        // =========================
        if (data.type === "client-connect") {
            clients[data.id] = ws;
            ws.clientId = data.id;

            console.log("👤 Client connecté:", data.id);

            // 🔥 AJOUT IMPORTANT
            ensureClient(data.id, data.name);
            save();

            sendToAdmins({
                type: "new-client",
                id: data.id,
                name: conversations[data.id].name
            });
        }

        if (data.type === "check-client") {
            ws.send(JSON.stringify({
                type: "client-exists",
                exists: !!conversations[data.id]
            }));
        }

        if (data.type === "rename-client") {
            ensureClient(data.id);

            conversations[data.id].name = data.name;
            save();

            sendToAdmins({
                type: "client-renamed",
                id: data.id,
                name: data.name
            });
        }

        // =========================
        // ADMIN CONNECT
        // =========================
        if (data.type === "admin-connect") {
            ws.isAdmin = true;
            admins.push(ws);

            if (ws.isAdmin) {
                admins = admins.filter(a => a !== ws);
            }

            console.log("🧑‍💻 Admin connecté");

            // 🔥 fusion clients + conversations
            let allClients = Array.from(new Set([
                ...Object.keys(conversations),
                ...Object.keys(clients)
            ]));

            // 🔥 trier par date du dernier message (récent en haut)
            allClients.sort((a, b) => {

                ensureClient(a);
                ensureClient(b);

                let aMsgs = conversations[a].messages;
                let bMsgs = conversations[b].messages;

                let aTime = aMsgs.length
                    ? aMsgs[aMsgs.length - 1].time
                    : 0;

                let bTime = bMsgs.length
                    ? bMsgs[bMsgs.length - 1].time
                    : 0;

                return bTime - aTime;
            });

            sendToAdmins({
                type: "all-clients",
                clients: allClients.map(id => {
                    ensureClient(id);

                    return {
                        id: id,
                        name: conversations[id].name,
                        unread: conversations[id].unread
                    };
                })
            });


            // 🔥 marquer les online

            Object.keys(clients).forEach(id => {
                sendToAdmins({
                    type: "client-online",
                    id: id
                });
            });

        }

        // =========================
        // CLIENT → ADMIN
        // =========================
        if (data.type === "client-message") {

            ensureClient(data.id);

            let message = {
                from: "client",
                text: data.message,
                time: Date.now(),
                delivered: false,
                seen: false
            };

            conversations[data.id].messages.push(message);
            conversations[data.id].unread++;

            // 🔥 vérifier si admin connecté
            let adminOnline = admins.some(a =>
                a.readyState === WebSocket.OPEN
            );

            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN && client.isAdmin) {
                    adminOnline = true;
                }
            });

            if (adminOnline) {
                message.delivered = true;
            }

            save();

            // 🔥 envoyer message aux admins
            sendToAdmins({
                type: "client-message",
                id: data.id,
                message: data.message,
                time: message.time,
                unread: conversations[data.id].unread
            });

            // 🔥 notifier le client pour refresh checks
            let sender = clients[data.id];

            if (sender && sender.readyState === WebSocket.OPEN) {
                sender.send(JSON.stringify({
                    type: adminOnline
                        ? "client-delivered"
                        : "client-status-update"
                }));
            }
        }

        // =========================
        // ADMIN → CLIENT
        // =========================
        if (data.type === "admin-message") {
            ensureClient(data.to);
            let message = {
                from: "admin",
                text: data.message,
                time: Date.now(),
                seen: false
            };
            conversations[data.to].messages.push(message);
            save();
            console.log("📤 Admin →", data.to, ":", message);

            let client = clients[data.to];
            if (client && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: "admin-message",
                    message: data.message,
                    time: message.time
                }));
            } else {
                console.log("⚠️ Client non disponible:", data.to);
            }
        }

        // =========================
        // 📜 HISTORIQUE
        // =========================
        if (data.type === "get-history") {
            // 🔥 relire fichier JSON à chaque demande
            if (fs.existsSync(FILE)) {
                try {
                    conversations = JSON.parse(fs.readFileSync(FILE));
                } catch {
                    conversations = {};
                }
            }

            ensureClient(data.id);

            let history = conversations[data.id].messages;

            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: "history",
                    id: data.id,
                    messages: history
                }));
            }
        }

        if (data.type === "admin-open-client") {
            ensureClient(data.id);

            conversations[data.id].unread = 0;
            conversations[data.id].messages.forEach(msg => {
            if (msg.from === "client") {
                    msg.seen = true;
                }
            });
            save();

            let client = clients[data.id];

            if (client && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: "client-seen"
                }));
            }

            sendToAdmins({
                type: "unread-reset",
                id: data.id
            });
        }

        // =========================
        // CLIENT A VU LES MESSAGES
        // =========================
        if (data.type === "seen") {

            ensureClient(data.id);

            let msgs = conversations[data.id].messages;

            msgs.forEach(msg => {
                if (msg.from === "admin") {
                    msg.seen = true;
                }
            });

            save();
            
            sendToAdmins({
                type: "seen",
                id: data.id
            });
        }
    });

    // =========================
    // ❌ DECONNEXION
    // =========================
    ws.on('close', () => {
        if (ws.clientId) {
            console.log("❌ Client offline:", ws.clientId);
            delete clients[ws.clientId]; // 🔥 nettoyage
        }

        if (ws.isAdmin) {
            console.log("❌ Admin offline");
        }
    });

    ws.on('error', (err) => {
        console.log("⚠️ WebSocket error:", err.message);
    });
});


// =============================
// ❤️ HEARTBEAT GLOBAL
// =============================
const interval = setInterval(() => {
    wss.clients.forEach(ws => {
        if (!ws.isAlive) {
            console.log("💀 Terminate socket");
            return ws.terminate();
        }

        ws.isAlive = false;
        ws.ping();
    });
}, 30000);


// 🔹 port dynamique (important pour Render)
const PORT = process.env.PORT || 3000;
// =============================
server.listen(PORT, () => {
    console.log("🚀 Serveur lancé sur port" + PORT, Date.now());
});