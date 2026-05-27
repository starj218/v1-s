// Render 전용 9개 매칭 패드 온라인 총게임 백엔드 서버 (server.js)
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});

let lobbyPlayers = {}; 
let readyPads = {
    'A': [], 'B': [], 'C': [],
    'D': [], 'E': [], 'F': [],
    'G': [], 'H': [], 'I': []
};

function broadcastPadStatus() {
    let status = {};
    Object.keys(readyPads).forEach(padId => { status[padId] = readyPads[padId].length; });
    io.emit('readyStatusUpdate', status);
}

io.on('connection', (socket) => {
    console.log(`🎮 유저 접속: ${socket.id}`);

    lobbyPlayers[socket.id] = {
        id: socket.id,
        pos: { x: (Math.random() - 0.5) * 5, y: 1.6, z: 12 },
        rotY: 0,
        hp: 100,
        currentPad: null
    };

    socket.emit('currentPlayers', lobbyPlayers);
    socket.broadcast.emit('newPlayer', lobbyPlayers[socket.id]);
    broadcastPadStatus();

    socket.on('playerMovement', (movementData) => {
        if (lobbyPlayers[socket.id]) {
            lobbyPlayers[socket.id].pos = movementData.pos;
            lobbyPlayers[socket.id].rotY = movementData.rotY;
            socket.broadcast.emit('playerMoved', lobbyPlayers[socket.id]);
        }
    });

    socket.on('toggleReady', (data) => {
        if (!lobbyPlayers[socket.id]) return;
        const { padId, isReady } = data;

        if (isReady) {
            if (lobbyPlayers[socket.id].currentPad && lobbyPlayers[socket.id].currentPad !== padId) {
                const oldPad = lobbyPlayers[socket.id].currentPad;
                readyPads[oldPad] = readyPads[oldPad].filter(id => id !== socket.id);
            }
            lobbyPlayers[socket.id].currentPad = padId;
            if (!readyPads[padId].includes(socket.id)) readyPads[padId].push(socket.id);
        } else {
            if (lobbyPlayers[socket.id].currentPad === padId) {
                lobbyPlayers[socket.id].currentPad = null;
                readyPads[padId] = readyPads[padId].filter(id => id !== socket.id);
            }
        }
        broadcastPadStatus();

        if (readyPads[padId] && readyPads[padId].length >= 2) {
            const p1 = readyPads[padId].shift();
            const p2 = readyPads[padId].shift();
            const roomId = `room_${padId}_${Date.now()}`;

            lobbyPlayers[p1].currentPad = null;
            lobbyPlayers[p2].currentPad = null;

            // 아레나 입장 전 두 유저의 체력을 100으로 완전 초기화
            lobbyPlayers[p1].hp = 100;
            lobbyPlayers[p2].hp = 100;

            io.to(p1).emit('matchFound', { roomId, role: 'p1', opponentId: p2, padId });
            io.to(p2).emit('matchFound', { roomId, role: 'p2', opponentId: p1, padId });
            broadcastPadStatus();
        }
    });

    socket.on('shoot', (shootData) => { socket.broadcast.emit('opponentShoot', shootData); });
    
    // 🎯 HP 디버깅의 핵심: 맞은 유저에게 데미지를 주고, 맞춘 사람에게도 깎인 피를 동기화하여 전송!
    socket.on('hitPlayer', (data) => { 
        const target = lobbyPlayers[data.targetId];
        if (target) {
            target.hp = Math.max(0, target.hp - data.damage);
            // 1. 맞은 사람 본인 화면에 피 깎기
            io.to(data.targetId).emit('damaged', { damage: data.damage, currentHp: target.hp }); 
            // 2. 때린 사람(상대방) 화면의 '오른쪽 상대 HP 바'도 실시간으로 깎이도록 전송!
            socket.emit('updateEnemyHP', { enemyHp: target.hp });
        }
    });
    
    socket.on('matchOver', (data) => {
        io.to(data.winnerId).emit('gameResult', 'win');
        io.to(data.loserId).emit('gameResult', 'lose');
    });

    socket.on('disconnect', () => {
        const padId = lobbyPlayers[socket.id]?.currentPad;
        if (padId && readyPads[padId]) readyPads[padId] = readyPads[padId].filter(id => id !== socket.id);
        delete lobbyPlayers[socket.id];
        io.emit('playerDisconnected', socket.id);
        broadcastPadStatus();
    });
});

const listener = http.listen(process.env.PORT || 3000, () => {
    console.log(`🚀 서버 구동 중: 포트 ${listener.address().port}`);
});
