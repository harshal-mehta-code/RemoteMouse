const socket = io();
const touchpad = document.getElementById('touchpad');
const status = document.getElementById('status');
const sensitivitySlider = document.getElementById('sensitivity');
const sessionToggle = document.getElementById('session-toggle');
const keyboardToggle = document.getElementById('keyboard-toggle');
const keyboardContainer = document.getElementById('keyboard-container');
const keyboardInput = document.getElementById('keyboard-input');

let lastX = 0;
let lastY = 0;
let isTouching = false;
let startTouchTime = 0;
let moveCount = 0;
let fingerCount = 0;

// Advanced state
let lastTapTime = 0;
let isDragging = false;
let dragTimeout = null;

// Movement buffer for animation frame
let pendingDx = 0;
let pendingDy = 0;
let pendingScrollY = 0;

socket.on('connect', () => {
    status.innerText = 'Connected';
    status.style.color = '#4caf50';
    sessionToggle.innerText = 'Disconnect';
    sessionToggle.classList.remove('disconnected');
});

socket.on('disconnect', () => {
    status.innerText = 'Disconnected';
    status.style.color = '#f44336';
    sessionToggle.innerText = 'Connect';
    sessionToggle.classList.add('disconnected');
});

sessionToggle.addEventListener('click', () => {
    if (socket.connected) {
        socket.disconnect();
    } else {
        socket.connect();
    }
});

keyboardToggle.addEventListener('click', () => {
    const isHidden = keyboardContainer.classList.toggle('hidden');
    if (!isHidden) {
        keyboardInput.focus();
    }
});

keyboardInput.addEventListener('input', (e) => {
    const text = e.target.value;
    if (text.length > 0) {
        socket.emit('keyboardType', { text: text });
        e.target.value = ''; // Clear for next character/string
    }
});

keyboardInput.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace') {
        socket.emit('keyboardTap', { key: 'backspace' });
    } else if (e.key === 'Enter') {
        socket.emit('keyboardTap', { key: 'enter' });
        e.target.value = '';
    }
});

// High-frequency update loop
function update() {
    if (!socket.connected) {
        requestAnimationFrame(update);
        return;
    }

    const sensitivity = parseFloat(sensitivitySlider.value);
    
    if (pendingDx !== 0 || pendingDy !== 0) {
        const eventName = isDragging ? 'mouseDrag' : 'mouseMove';
        socket.emit(eventName, { dx: pendingDx * sensitivity, dy: pendingDy * sensitivity });
        pendingDx = 0;
        pendingDy = 0;
    }
    
    if (pendingScrollY !== 0) {
        socket.emit('mouseScroll', { deltaY: pendingScrollY * sensitivity });
        pendingScrollY = 0;
    }
    
    requestAnimationFrame(update);
}
requestAnimationFrame(update);

touchpad.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (!socket.connected) return;

    isTouching = true;
    touchpad.style.backgroundColor = '#3c3c3c'; 
    fingerCount = e.touches.length;
    
    const touch = e.touches[0];
    lastX = touch.clientX;
    lastY = touch.clientY;
    
    startTouchTime = Date.now();
    moveCount = 0;

    // Handle Long Press for Dragging
    if (fingerCount === 1) {
        dragTimeout = setTimeout(() => {
            if (moveCount < 5 && isTouching) {
                isDragging = true;
                socket.emit('mouseDown', { button: 'left' });
                touchpad.style.backgroundColor = '#007aff'; // Blue feedback for dragging
                if (navigator.vibrate) navigator.vibrate(50);
            }
        }, 500);
    }
});

touchpad.addEventListener('touchmove', (e) => {
    if (!isTouching || !socket.connected) return;
    e.preventDefault();
    
    const touch = e.touches[0];
    const dx = touch.clientX - lastX;
    const dy = touch.clientY - lastY;
    
    lastX = touch.clientX;
    lastY = touch.clientY;
    
    moveCount++;
    
    // Cancel drag timeout if we moved too much before it triggered
    if (moveCount > 5 && dragTimeout) {
        clearTimeout(dragTimeout);
        dragTimeout = null;
    }

    if (e.touches.length === 1) {
        pendingDx += dx;
        pendingDy += dy;
    } else if (e.touches.length === 2) {
        pendingScrollY += dy;
    }
});

touchpad.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (!isTouching) return;
    
    if (dragTimeout) {
        clearTimeout(dragTimeout);
        dragTimeout = null;
    }

    const duration = Date.now() - startTouchTime;
    const now = Date.now();
    
    if (isDragging) {
        socket.emit('mouseUp', { button: 'left' });
        isDragging = false;
    } else if (socket.connected && duration < 300 && moveCount < 10) {
        if (fingerCount === 1) {
            // Check for double tap
            if (now - lastTapTime < 300) {
                socket.emit('mouseClick', { button: 'left', double: true });
                lastTapTime = 0; // Reset
            } else {
                socket.emit('mouseClick', { button: 'left' });
                lastTapTime = now;
            }
        } else if (fingerCount === 2) {
            socket.emit('mouseClick', { button: 'right' });
        }
    }
    
    if (e.touches.length === 0) {
        isTouching = false;
        touchpad.style.backgroundColor = '#2c2c2c'; 
        fingerCount = 0;
        pendingDx = 0;
        pendingDy = 0;
        pendingScrollY = 0;
    } else {
        fingerCount = e.touches.length;
    }
});
