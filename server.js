// Dependencies
var express = require('express');
var http = require('http');
var path = require('path');
var socketIO = require('socket.io');

// Local dependencies
var rand = require('./lib/rand.js');
var game = require('./lib/dreamteam.js');

var app = express();
var server = http.Server(app);
var io = socketIO(server);
app.set('port', 5000);

// Routing
app.use('/static', express.static(__dirname + '/static'));
app.get('/', function(request, response) {
    response.sendFile(path.join(__dirname, 'index.html'));
});

server.listen(5000, function() {
    console.log('Starting server at http://localhost:'+5000);
});

io.on('connection', newSession);

var startTime = new Date();
setInterval(function() {
    var now = new Date();
    var elapsed = now - startTime;
    var elapsedStr = '' + elapsed / 1000;
    io.sockets.emit('timesync', elapsedStr);
}, 1000);

function newSession(socket) {
    var remoteAddress = socket.client.conn.remoteAddress;
    var username = rand.username();

    console.log('User ' + username + ' (' + remoteAddress + ') connected');

    socket.on('reply', function(data) {
        console.log(remoteAddress + ': ' + data);
    });
    socket.on('disconnect', function(socket) {
        console.log(username + " disconnected");
    });

    var promptCount = 0;
    setInterval(function() {
        socket.emit('prompt', 'Prompt #' + promptCount++);
        socket.emit('clearallcontrol');
        socket.emit('setupcontrol', new game.Control());
    }, 2000);

    socket.on('action', function(data) {
        console.log(data);
    })
}