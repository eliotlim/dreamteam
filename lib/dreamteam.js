var rand = require('./rand.js');

class Control {
    constructor() {
        this.type = "choice-buttons";
        this.object = rand.username();
        this.choices = [
            "ON", "OFF"
        ];
    }
}

module.exports.Control = Control;
