// server.js (Node.js + Socket.io 서버)
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" } // 모든 클라이언트 접속 허용
});

let lobbyPlayers = {}; // 로비에 있는 플레이어들
let activeRooms = {};   // 현재 진행 중인 게임방들
let readyPlayers = []; // 발판에 올라선 플레이어 ID 목록

io.on('connection', (socket) => {
    console.log(`🎮 유저 접속함: ${socket.id}`);

    // 새로운 플레이어 초기화
    lobbyPlayers[socket.id] = {
        id: socket.id,
        pos: { x: (Math.random() - 0.5) * 5, y: 1.6, z: 12 }, // 스폰 분산
        rotY: 0,
        hp: 100,
        isReady: false
    };

    // 기존 플레이어 목록을 새로 들어온 유저에게 전달
    socket.emit('currentPlayers', lobbyPlayers);
    // 다른 유저들에게 내가 접속했음을 알림
    socket.broadcast.emit('newPlayer', lobbyPlayers[socket.id]);

    // 실시간 위치/움직임 동기화
    socket.on('playerMovement', (movementData) => {
        if (lobbyPlayers[socket.id]) {
            lobbyPlayers[socket.id].pos = movementData.pos;
            lobbyPlayers[socket.id].rotY = movementData.rotY;
            // 다른 모든 유저에게 내 위치 브로드캐스팅
            socket.broadcast.emit('playerMoved', lobbyPlayers[socket.id]);
        }
    });

    // 매칭 발판 상태 동기화 (발판 오르내릴 때)
    socket.on('toggleReady', (isReady) => {
        if (!lobbyPlayers[socket.id]) return;
        
        lobbyPlayers[socket.id].isReady = isReady;
        
        if (isReady) {
            if (!readyPlayers.includes(socket.id)) readyPlayers.push(socket.id);
        } else {
            readyPlayers = readyPlayers.filter(id => id !== socket.id);
        }

        // 전체 유저에게 발판 대기 상태 전송
        io.emit('readyStatusUpdate', {
            readyCount: readyPlayers.length,
            lobbyPlayers: lobbyPlayers
        });

        // 💡 2명이 발판에 올라오면 즉시 1v1 아레나 매칭 완료!
        if (readyPlayers.length >= 2) {
            const p1 = readyPlayers.shift();
            const p2 = readyPlayers.shift();
            const roomId = `room_${Date.now()}`;

            activeRooms[roomId] = { p1, p2 };

            // 발판 준비 상태 강제 리셋
            if(lobbyPlayers[p1]) lobbyPlayers[p1].isReady = false;
            if(lobbyPlayers[p2]) lobbyPlayers[p2].isReady = false;

            // 두 유저에게 매칭 완료 및 매치 룸 전송 (순간이동 명령)
            io.to(p1).emit('matchFound', { roomId, role: 'p1', opponent: p2 });
            io.to(p2).emit('matchFound', { roomId, role: 'p2', opponent: p1 });

            // 로비에 남은 유저들에게 발판 리셋 반영
            io.emit('readyStatusUpdate', { readyCount: readyPlayers.length, lobbyPlayers: lobbyPlayers });
        }
    });

    // 실시간 사격 이벤트 동기화 (상대방 화면에 탄도 궤적 그리기용)
    socket.on('shoot', (shootData) => {
        socket.broadcast.emit('opponentShoot', shootData);
    });

    // 타격 판정 및 데미지 동기화
    socket.on('hitPlayer', (data) => {
        // data = { targetId, damage }
        io.to(data.targetId).emit('damaged', { damage: data.damage, attacker: socket.id });
    });

    // 대결 종료 (사망 시 로비 송환)
    socket.on('matchOver', (data) => {
        // data = { roomId, winnerId, loserId }
        io.to(data.winnerId).emit('gameResult', 'win');
        io.to(data.loserId).emit('gameResult', 'lose');
    });

    // 연결 종료 시 리셋
    socket.on('disconnect', () => {
        console.log(`❌ 유저 나감: ${socket.id}`);
        delete lobbyPlayers[socket.id];
        readyPlayers = readyPlayers.filter(id => id !== socket.id);
        io.emit('playerDisconnected', socket.id);
    });
});

const PORT = 3000;
http.listen(PORT, () => {
    console.log(`🚀 멀티플레이어 게임 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
