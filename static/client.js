var socket = io();

var timeDisplay = document.getElementById('timer');
var promptDisplay = document.getElementById('prompt');

socket.on('timesync', function(data) {
    timeDisplay.textContent = data;
});

socket.on('prompt', function(data) {
    promptDisplay.textContent = data;
});

socket.on('disconnect', function(data) {
    timeDisplay.textContent = 'Connection lost. Reconnecting...';
});