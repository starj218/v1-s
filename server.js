// Render 전용 멀티 매칭 온라인 총게임 백엔드 서버 (server.js)
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});

let lobbyPlayers = {}; // 로비 플레이어 데이터
// 각 발판(A, B, C)별로 대기 중인 유저 목록 관리
let readyPads = {
    'A': [],
    'B': [],
    'C': []
};

io.on('connection', (socket) => {
    console.log(`🎮 유저 접속: ${socket.id}`);

    // 초기 체력 100 설정
    lobbyPlayers[socket.id] = {
        id: socket.id,
        pos: { x: (Math.random() - 0.5) * 5, y: 1.6, z: 12 },
        rotY: 0,
        hp: 100,
        currentPad: null
    };

    socket.emit('currentPlayers', lobbyPlayers);
    socket.broadcast.emit('newPlayer', lobbyPlayers[socket.id]);

    socket.on('playerMovement', (movementData) => {
        if (lobbyPlayers[socket.id]) {
            lobbyPlayers[socket.id].pos = movementData.pos;
            lobbyPlayers[socket.id].rotY = movementData.rotY;
            socket.broadcast.emit('playerMoved', lobbyPlayers[socket.id]);
        }
    });

    // 어떤 발판(padId)에 올라가거나 내려왔을 때 처리
    socket.on('toggleReady', (data) => {
        if (!lobbyPlayers[socket.id]) return;
        const { padId, isReady } = data;

        if (isReady) {
            // 다른 발판에 이미 들어가 있다면 제거
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

        // 모든 유저에게 각 발판들의 인원 상태를 브로드캐스트
        io.emit('readyStatusUpdate', {
            padA: readyPads['A'].length,
            padB: readyPads['B'].length,
            padC: readyPads['C'].length
        });

        // 특정 발판에 2명이 모이면 그 발판 유저들끼리 즉시 매칭!
        if (readyPads[padId].length >= 2) {
            const p1 = readyPads[padId].shift();
            const p2 = readyPads[padId].shift();
            const roomId = `room_${padId}_${Date.now()}`;

            lobbyPlayers[p1].currentPad = null;
            lobbyPlayers[p2].currentPad = null;

            io.to(p1).emit('matchFound', { roomId, role: 'p1', opponentId: p2, padId });
            io.to(p2).emit('matchFound', { roomId, role: 'p2', opponentId: p1, padId });
            
            // 매칭 후 발판 인원 재공지
            io.emit('readyStatusUpdate', {
                padA: readyPads['A'].length,
                padB: readyPads['B'].length,
                padC: readyPads['C'].length
            });
        }
    });

    socket.on('shoot', (shootData) => { socket.broadcast.emit('opponentShoot', shootData); });
    
    // 타격 판정: 헤드건 몸통이건 상관없이 무조건 고정 데미지를 주어 15발 맞으면 죽게 설계
    socket.on('hitPlayer', (data) => { 
        io.to(data.targetId).emit('damaged', { damage: data.damage }); 
    });
    
    socket.on('matchOver', (data) => {
        io.to(data.winnerId).emit('gameResult', 'win');
        io.to(data.loserId).emit('gameResult', 'lose');
    });

    socket.on('disconnect', () => {
        console.log(`❌ 유저 퇴장: ${socket.id}`);
        const padId = lobbyPlayers[socket.id]?.currentPad;
        if (padId) {
            readyPads[padId] = readyPads[padId].filter(id => id !== socket.id);
        }
        delete lobbyPlayers[socket.id];
        io.emit('playerDisconnected', socket.id);
        io.emit('readyStatusUpdate', {
            padA: readyPads['A']?.length || 0,
            padB: readyPads['B']?.length || 0,
            padC: readyPads['C']?.length || 0
        });
    });
});

const listener = http.listen(process.env.PORT || 3000, () => {
    console.log(`🚀 서버가 포트 ${listener.address().port}에서 작동 중입니다!`);
});
