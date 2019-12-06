var fs = require('fs');

module.exports.username = username;

var adjectiveLib = fs.readFileSync('resources/adjectives.txt').toString().split("\n");
var nounLib = fs.readFileSync('resources/nouns.txt').toString().split("\n");

function adjective() {
    return element(adjectiveLib);
}

function noun() {
    return element(nounLib);
}

function element(array) {
    return array[Math.floor(Math.random() * array.length)];
}

function username() {
    return adjective() + '_' + noun();
}