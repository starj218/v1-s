// 8개 독립 룸 완벽 동기화 + 난입 방지 + 정원 초과 시스템 (server.js)
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});

let lobbyPlayers = {}; 
let readyPlayers = []; // 로비 노란 발판에서 매칭 대기 중인 유저들

// 최대 8개의 독립된 게임방 생성 및 관리
const MAX_ROOMS = 8;
let gameRooms = {};
for (let i = 1; i <= MAX_ROOMS; i++) {
    gameRooms[`room_${i}`] = {
        id: `room_${i}`,
        status: 'waiting', // 'waiting' (대기중) 또는 'playing' (게임중)
        p1: null,
        p2: null,
        players: {} // 해당 방 내부 유저들의 실시간 위치/HP 정보
    };
}

// 로비에 있는 사람들에게만 현재 대기 열 인원 브로드캐스트
function broadcastLobbyStatus() {
    io.emit('readyStatusUpdate', readyPlayers.length);
}

io.on('connection', (socket) => {
    console.log(`🎮 유저 접속: ${socket.id}`);

    // 최초 접속 시 로비 상태로 등록
    lobbyPlayers[socket.id] = {
        id: socket.id,
        pos: { x: (Math.random() - 0.5) * 5, y: 1.6, z: 12 },
        rotY: 0,
        isReady: false
    };

    // 새로 들어온 유저에게 기존 로비 유저들 정보 전송
    socket.emit('currentPlayers', lobbyPlayers);
    // 다른 로비 유저들에게 내 등장 알림
    socket.broadcast.emit('newPlayer', lobbyPlayers[socket.id]);
    broadcastLobbyStatus();

    // [움직임 동기화] 로비 상태일 때와 게임 룸 안 상태일 때를 철저히 분리
    socket.on('playerMovement', (movementData) => {
        const roomId = movementData.roomId;

        if (roomId && gameRooms[roomId]) {
            // 1vs1 게임방 내부 움직임 동기화 (그 방에 있는 상대방에게만 전송)
            const room = gameRooms[roomId];
            if (room.players[socket.id]) {
                room.players[socket.id].pos = movementData.pos;
                room.players[socket.id].rotY = movementData.rotY;
                socket.to(roomId).emit('playerMoved', room.players[socket.id]);
            }
        } else if (lobbyPlayers[socket.id]) {
            // 로비 대기실 내부 움직임 동기화 (전체 전송)
            lobbyPlayers[socket.id].pos = movementData.pos;
            lobbyPlayers[socket.id].rotY = movementData.rotY;
            socket.broadcast.emit('playerMoved', lobbyPlayers[socket.id]);
        }
    });

    // [매칭 등록 / 취소] 노란 발판 상호작용
    socket.on('toggleReady', (data) => {
        if (!lobbyPlayers[socket.id]) return;
        const { isReady } = data;
        lobbyPlayers[socket.id].isReady = isReady;

        if (isReady) {
            if (!readyPlayers.includes(socket.id)) readyPlayers.push(socket.id);
        } else {
            readyPlayers = readyPlayers.filter(id => id !== socket.id);
        }
        broadcastLobbyStatus();

        // 대기열에 2명이 모였다면 빈 방 탐색 시작!
        if (readyPlayers.length >= 2) {
            // 'waiting' 상태인 빈 방이 있는지 확인
            let targetRoom = null;
            for (let i = 1; i <= MAX_ROOMS; i++) {
                if (gameRooms[`room_${i}`].status === 'waiting') {
                    targetRoom = gameRooms[`room_${i}`];
                    break;
                }
            }

            // ❌ 만약 8개 방이 전부 꽉 차서 돌려 쓸 방이 없다면?
            if (!targetRoom) {
                // 대기열 맨 앞 두 명에게 정원 초과 에러 알림 뿜기
                io.to(readyPlayers[0]).emit('serverFullError');
                io.to(readyPlayers[1]).emit('serverFullError');
                return; 
            }

            // ⭕ 빈 방 매칭 성사 처리
            const p1Idx = readyPlayers.shift();
            const p2Idx = readyPlayers.shift();

            targetRoom.status = 'playing'; // 방 잠금 처리 (난입 원천 차단)
            targetRoom.p1 = p1Idx;
            targetRoom.p2 = p2Idx;
            
            targetRoom.players[p1Idx] = { id: p1Idx, pos: { x: 0, y: 1.6, z: -22 }, rotY: 0, hp: 100 };
            targetRoom.players[p2Idx] = { id: p2Idx, pos: { x: 0, y: 1.6, z: -48 }, rotY: Math.PI, hp: 100 };

            // 로비 명단에서 두 사람 삭제 후 다른 사람들에게 증발 처리 전달
            delete lobbyPlayers[p1Idx];
            delete lobbyPlayers[p2Idx];
            io.emit('playerDisconnected', p1Idx);
            io.emit('playerDisconnected', p2Idx);

            // 해당 소켓들을 전용 룸 채널에 입장시킴 (통신 격리)
            io.sockets.sockets.get(p1Idx)?.join(targetRoom.id);
            io.sockets.sockets.get(p2Idx)?.join(targetRoom.id);

            // 각자에게 독립방 정보 전달하며 매칭 시작 신호 탕!
            io.to(p1Idx).emit('matchFound', { roomId: targetRoom.id, role: 'p1', opponentId: p2Idx });
            io.to(p2Idx).emit('matchFound', { roomId: targetRoom.id, role: 'p2', opponentId: p1Idx });
            broadcastLobbyStatus();
        }
    });

    // [사격 신호] 내가 속한 게임방의 상대방에게만 사격 궤적 전송
    socket.on('shoot', (shootData) => {
        if (shootData.roomId) {
            socket.to(shootData.roomId).emit('opponentShoot', shootData);
        }
    });
    
    // [피격 처리] 정확히 해당 방 안의 상대 HP만 타격 가함
    socket.on('hitPlayer', (data) => { 
        const room = gameRooms[data.roomId];
        if (room && room.players[data.targetId]) {
            const target = room.players[data.targetId];
            target.hp = Math.max(0, target.hp - data.damage);

            io.to(data.targetId).emit('damaged', { damage: data.damage, currentHp: target.hp }); 
            socket.emit('updateEnemyHP', { enemyHp: target.hp });
        }
    });
    
    // [게임 종료] 방 초기화 및 유저들을 다시 로비로 해방
    socket.on('matchOver', (data) => {
        const { roomId, winnerId, loserId } = data;
        const room = gameRooms[roomId];
        if (!room) return;

        io.to(winnerId).emit('gameResult', 'win');
        io.to(loserId).emit('gameResult', 'lose');

        // 해당 방 소켓 룸 채널 해제
        io.sockets.sockets.get(winnerId)?.leave(roomId);
        io.sockets.sockets.get(loserId)?.leave(roomId);

        // 다시 로비 플레이어 명단에 기본 상태로 복구 등록
        lobbyPlayers[winnerId] = { id: winnerId, pos: { x: (Math.random() - 0.5) * 5, y: 1.6, z: 12 }, rotY: 0, isReady: false };
        lobbyPlayers[loserId] = { id: loserId, pos: { x: (Math.random() - 0.5) * 5, y: 1.6, z: 12 }, rotY: 0, isReady: false };

        // 로비에 있는 사람들에게 이 두 명의 재생성을 뿌려줌
        io.emit('newPlayer', lobbyPlayers[winnerId]);
        io.emit('newPlayer', lobbyPlayers[loserId]);

        // 방 데이터 완전 공장 초기화 (다음 매칭 팀을 위해 오픈)
        room.status = 'waiting';
        room.p1 = null;
        room.p2 = null;
        room.players = {};

        broadcastLobbyStatus();
    });

    // [접속 끊김] 로비든 게임방이든 완벽하게 추적하여 흔적 제거
    socket.on('disconnect', () => {
        readyPlayers = readyPlayers.filter(id => id !== socket.id);
        delete lobbyPlayers[socket.id];
        io.emit('playerDisconnected', socket.id);

        // 유저가 탈주한 게임방이 있는지 스캔
        for (let i = 1; i <= MAX_ROOMS; i++) {
            const room = gameRooms[`room_${i}`];
            if (room.p1 === socket.id || room.p2 === socket.id) {
                const opponentId = room.p1 === socket.id ? room.p2 : room.p1;
                
                if (opponentId) {
                    io.to(opponentId).emit('gameResult', 'win'); // 남은 사람에게 부전승 처리
                    io.sockets.sockets.get(opponentId)?.leave(room.id);
                    lobbyPlayers[opponentId] = { id: opponentId, pos: { x: (Math.random() - 0.5) * 5, y: 1.6, z: 12 }, rotY: 0, isReady: false };
                    io.emit('newPlayer', lobbyPlayers[opponentId]);
                }

                room.status = 'waiting';
                room.p1 = null;
                room.p2 = null;
                room.players = {};
                break;
            }
        }
        broadcastLobbyStatus();
    });
});

const listener = http.listen(process.env.PORT || 3000, () => {
    console.log(`🚀 멀티 룸 FPS 서버 구동 중: 포트 ${listener.address().port}`);
});
