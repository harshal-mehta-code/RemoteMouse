// Test double for the `robotjs` native addon.
//
// Tests alias the module here and assert on the recorded calls, so a test run
// never moves the real cursor or types into whatever window has focus. The
// stub is deliberate isolation, not a workaround: robotjs does ship prebuilt
// binaries, but loading the real addon would make the suite drive the machine
// running it.
const calls = [];

module.exports = {
    calls,
    reset: () => calls.splice(0, calls.length),
    getMousePos: () => ({ x: 100, y: 100 }),
    moveMouse: (x, y) => calls.push(['moveMouse', x, y]),
    mouseClick: (button, double) => calls.push(['mouseClick', button, double]),
    mouseToggle: (state, button) => calls.push(['mouseToggle', state, button]),
    scrollMouse: (x, y) => calls.push(['scrollMouse', x, y]),
    typeString: (text) => calls.push(['typeString', text]),
    keyTap: (key, mods) => calls.push(['keyTap', key, mods]),
    keyToggle: (key, state) => calls.push(['keyToggle', key, state]),
};
