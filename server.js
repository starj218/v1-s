// Render 전용 9개 매칭 패드 온라인 총게임 백엔드 서버 (server.js)
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});

let lobbyPlayers = {}; 
// 9개의 발판(A ~ I) 대기 목록 생성
let readyPads = {
    'A': [], 'B': [], 'C': [],
    'D': [], 'E': [], 'F': [],
    'G': [], 'H': [], 'I': []
};

// 실시간 인원 상태를 묶어서 모든 유저에게 보내주는 함수
function broadcastPadStatus() {
    let status = {};
    Object.keys(readyPads).forEach(padId => {
        status[padId] = readyPads[padId].length;
    });
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
    broadcastPadStatus(); // 접속하자마자 발판 인원 갱신

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
            if (!readyPads[padId].includes(socket.id)) {
                readyPads[padId].push(socket.id);
            }
        } else {
            if (lobbyPlayers[socket.id].currentPad === padId) {
                lobbyPlayers[socket.id].currentPad = null;
                readyPads[padId] = readyPads[padId].filter(id => id !== socket.id);
            }
        }

        broadcastPadStatus();

        // 어떤 패드든 2명이 차면 즉시 별도 룸으로 던져 매칭 시작!
        if (readyPads[padId] && readyPads[padId].length >= 2) {
            const p1 = readyPads[padId].shift();
            const p2 = readyPads[padId].shift();
            const roomId = `room_${padId}_${Date.now()}`;

            lobbyPlayers[p1].currentPad = null;
            lobbyPlayers[p2].currentPad = null;

            io.to(p1).emit('matchFound', { roomId, role: 'p1', opponentId: p2, padId });
            io.to(p2).emit('matchFound', { roomId, role: 'p2', opponentId: p1, padId });
            
            broadcastPadStatus();
        }
    });

    socket.on('shoot', (shootData) => { socket.broadcast.emit('opponentShoot', shootData); });
    socket.on('hitPlayer', (data) => { io.to(data.targetId).emit('damaged', { damage: data.damage }); });
    
    socket.on('matchOver', (data) => {
        io.to(data.winnerId).emit('gameResult', 'win');
        io.to(data.loserId).emit('gameResult', 'lose');
    });

    socket.on('disconnect', () => {
        console.log(`❌ 유저 퇴장: ${socket.id}`);
        const padId = lobbyPlayers[socket.id]?.currentPad;
        if (padId && readyPads[padId]) {
            readyPads[padId] = readyPads[padId].filter(id => id !== socket.id);
        }
        delete lobbyPlayers[socket.id];
        io.emit('playerDisconnected', socket.id);
        broadcastPadStatus();
    });
});

const listener = http.listen(process.env.PORT || 3000, () => {
    console.log(`🚀 서버가 포트 ${listener.address().port}에서 작동 중입니다!`);
});
