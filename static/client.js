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

socket.on('setupcontrol', function(control) {
    createControl(control);
});

var controlpanel = document.getElementById('control-panel-wrapper');
socket.on('clearallcontrol', function() {
    while (controlpanel.firstChild != null) {
        controlpanel.removeChild(controlpanel.firstChild);
    }
});

function createControl(control) {
    console.log(control.type);
    var card = document.createElement("card");
    card.classList.add('card');
    var cardbody = document.createElement("div");
    cardbody.classList.add('card-body');
    card.appendChild(cardbody);

    var cardtitle = document.createElement('h5');
    cardtitle.textContent = control.object;
    cardbody.appendChild(cardtitle);

    controlpanel.appendChild(card);
}