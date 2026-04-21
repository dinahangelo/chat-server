
const ws = new WebSocket("wss://cybercia-server.onrender.com");

// let currentClient = null;
let currentClient = localStorage.getItem("currentClient");
let conversations = {};
let unread = {};

const textarea = document.getElementById("msg");

textarea.addEventListener("input", () => {
    textarea.style.height = "auto"; // reset
    textarea.style.height = textarea.scrollHeight + "px";

    // 🔥 activer scroll si dépasse max-height
    if (textarea.scrollHeight > 150) {
        textarea.style.overflowY = "auto";
    } else {
        textarea.style.overflowY = "hidden";
    }
});

document.getElementById("msg").addEventListener("keydown", function(e) {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
    }
});

if (!currentClient) {
    document.getElementById("chatTittle").innerText = "Sélectionner un client";
}

function resetAll() {
    conversations = {};
    document.getElementById("chat").innerHTML = "";
    document.getElementById("clients").innerHTML = "";
}

function notify(message) {
    // 🔊 son
    document.getElementById("notifSound").play();

    // 🔔 notification
    if (Notification.permission === "granted") {
        new Notification("Nouveau message", {
            body: message
        });
    }
}

ws.onopen = () => {
    resetAll();
    console.log("✅ Admin connecté");

    ws.send(JSON.stringify({ type: "admin-connect" }));

    // 🔥 ne rien afficher pour le moment
    document.getElementById("chat").innerHTML = "";
    document.getElementById("chatTittle").innerText = "Sélectionner un client";

    if ("Notification" in window) {
        Notification.requestPermission();
    }
};

ws.onmessage = (event) => {
    let data = JSON.parse(event.data);

    // =========================
    // 🔥 TOUS LES CLIENTS (offline + online)
    // =========================
    if (data.type === "all-clients") {
        data.clients.forEach(c => {
            addClient(c.id, c.name);

            if (c.unread > 0) {
                updateBadge(c.id, c.unread);
            }
        });
    }

    // =========================
    // 🟢 CLIENT ONLINE
    // =========================
    if (data.type === "client-online") {
        let div = document.getElementById(data.id);

        if (div) {
            div.classList.remove("offline");
            div.classList.add("online");
        }
    }

    // =========================
    // 🔥 NOUVEAU CLIENT CONNECTÉ
    // =========================
    if (data.type === "new-client") {
        addClient(data.id, data.name);

        let div = document.getElementById(data.id);
        if (div) {
            div.classList.remove("offline");
            div.classList.add("online");
        }
    }

    // 🔥 message client
    if (data.type === "client-message") {

        moveClientToTop(data.id);
        if (!conversations[data.id]) {
            conversations[data.id] = [];
        }

        conversations[data.id].push({
            from: "client",
            text: data.message,
            time: data.time // 🔥 AJOUT ICI
        });

        if (data.id !== currentClient) {
            notify(data.message);
        }            

        // 🔥 si conversation NON ouverte → incrément badge
        if (data.id !== currentClient) {

            unread[data.id] = (unread[data.id] || 0) + 1;

            updateBadge(data.id);
        } else {
            afficherConversation();
        }
    }

    // 🔥 historique
    if (data.type === "history") {
        conversations[data.id] = data.messages;

        if (data.id === currentClient) {
            afficherConversation();
        }
    }

    if (data.type === "seen") {
        let msgs = conversations[data.id];

        if (msgs) {
            msgs.forEach(m => {
                if (m.from === "admin") {
                    m.seen = true;
                }
            });
        }

        afficherConversation(); // 🔥 refresh UI
    }

    if (data.type === "unread-reset") {
        let div = document.getElementById(data.id);
        if (!div) return;

        let badge = div.querySelector(".badge");
        if (badge) badge.remove();
    }

    if (data.type === "client-renamed") {
        let div = document.getElementById(data.id);

        if (!div) return;

        // garder classes online/offline/active
        let classes = div.className;

        div.innerHTML = `
            <strong class="client-name">${data.name}</strong><br>
            <small>${data.id}</small>
        `;

        div.className = classes;

        // remettre badge si existait
        if (unread[data.id] > 0) {
            updateBadge(data.id, unread[data.id]);
        }

        // si ouvert actuellement
        if (currentClient === data.id) {
            document.getElementById("chatTittle").innerText = data.name;
        }
    }
};

// ❌ SUPPRIMÉ : reload automatique
ws.onclose = () => {
    console.log("❌ Déconnecté (pas de reload)");
};

ws.onerror = (err) => console.log("⚠️ Erreur WebSocket", err);

function send() {
    let msg = document.getElementById("msg").value;

    if (!currentClient || msg === "") return;

    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: "admin-message",
            to: currentClient,
            message: msg
        }));
    } else {
        console.log("⚠️ Connexion fermée, message non envoyé");
    }

    if (!conversations[currentClient]) {
        conversations[currentClient] = [];
    }

    conversations[currentClient].push({
        from: "admin",
        text: msg,
        time: Date.now(),
        seen: false
    });

    afficherConversation();
    document.getElementById("msg").value = "";
    textarea.style.height = "auto";
    textarea.style.overflowY = "hidden";
}

function formatTime(ts) {
    if (!ts) return "--:--"; // sécurité

    let d = new Date(ts);

    return d.getHours().toString().padStart(2, '0') + ":" +
        d.getMinutes().toString().padStart(2, '0');
}

function afficherConversation() {
    let chat = document.getElementById("chat");

    if (!currentClient) {
        chat.innerHTML = "";
        return;
    }

    chat.innerHTML = "";

    let msgs = conversations[currentClient] || [];

    msgs.forEach(m => {
        let div = document.createElement("div");
        div.className = "msg " + (m.from === "admin" ? "admin" : "client-msg");

        div.innerHTML = `
            ${m.text.replace(/\n/g, "<br>")}
            <div style="font-size:10px; opacity:0.6; margin-top:5px;">
                ${formatTime(m.time)}
                ${m.from === "admin" ? (m.seen ? " <i class='fa-solid fa-check'></i><i class='fa-solid fa-check' style='margin-left:-4px;'></i>" : " <i class='fa-solid fa-check'></i>") : ""}
            </div>
        `;

        chat.appendChild(div);
    });

    chat.scrollTop = chat.scrollHeight;
}

function addClient(id, name = id) {
    if (document.getElementById(id)) return;

    let div = document.createElement("div");
    div.className = "client offline";
    div.id = id;

    div.innerHTML = `
        <strong class="client-name">${name}</strong><br>
        <small>${id}</small>
    `;

    // ✅ clic simple = ouvrir conversation
    div.onclick = () => {
        currentClient = id;
        localStorage.setItem("currentClient", id);

        document.querySelectorAll(".client")
            .forEach(c => c.classList.remove("active"));

        div.classList.add("active");

        let nom = div.querySelector(".client-name").innerText;
        document.getElementById("chatTittle").innerText = nom;

        ws.send(JSON.stringify({
            type: "get-history",
            id: id
        }));

        ws.send(JSON.stringify({
            type: "admin-open-client",
            id: id
        }));

        // 🔥 MOBILE → switch écran
        if (isMobile()) {
            document.body.classList.remove("show-clients");
            document.body.classList.add("show-chat");
            backBtn.style.display = "block";
            menuBtn.style.display = "none";
        }
    };

    // ✅ double clic = renommer
    div.ondblclick = () => {
        let ancienNom = div.querySelector(".client-name").innerText;

        let nouveauNom = prompt("Nouveau nom :", ancienNom);

        if (!nouveauNom || nouveauNom.trim() === "") return;

        ws.send(JSON.stringify({
            type: "rename-client",
            id: id,
            name: nouveauNom
        }));
    };

    document.getElementById("clients").appendChild(div);

    // restauration après refresh
    if (id === currentClient) {
        div.click();
    }
}

function moveClientToTop(id) {
    let clientDiv = document.getElementById(id);
    let container = document.getElementById("clients");

    if (clientDiv && container.firstChild !== clientDiv) {
        container.prepend(clientDiv);
    }
}

function updateBadge(id, count = null) {
    let clientDiv = document.getElementById(id);
    if (!clientDiv) return;

    let badge = clientDiv.querySelector(".badge");

    if (!badge) {
        badge = document.createElement("span");
        badge.className = "badge";
        clientDiv.appendChild(badge);
    }

    let value = count ?? parseInt(badge.innerText || 0) + 1;

    badge.innerText = value;
}

window.addEventListener("focus", () => {
    document.title = "Chat Support";
});


const menuBtn = document.getElementById("menuBtn");
const clients = document.getElementById("clients");

menuBtn.onclick = () => {
    clients.classList.toggle("open");
    document.body.classList.toggle("menu-open");
};

const backBtn = document.getElementById("backBtn");
function isMobile() {
    return window.innerWidth <= 768;
}

if (isMobile()) {
    document.body.classList.add("show-clients");
}

backBtn.onclick = () => {
    document.body.classList.remove("show-chat");
    document.body.classList.add("show-clients");

    backBtn.style.display = "none";
    menuBtn.style.display = "block";
};

if (isMobile()) {
    menuBtn.style.display = "none";
}