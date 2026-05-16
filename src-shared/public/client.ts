import { RemoteEvent, MouseButton } from '../types';

let socket: WebSocket | null = null;
const touchpad = document.getElementById('touchpad') as HTMLElement;
const statusText = document.getElementById('status') as HTMLElement;
const statusContainer = document.getElementById('connection-status') as HTMLElement;
const sensitivitySlider = document.getElementById('sensitivity') as HTMLInputElement;
const sensitivityVal = document.getElementById('sensitivity-val') as HTMLElement;
const sessionToggle = document.getElementById('session-toggle') as HTMLElement;
const keyboardToggle = document.getElementById('keyboard-toggle') as HTMLElement;
const keyboardContainer = document.getElementById('keyboard-container') as HTMLElement;
const keyboardInput = document.getElementById('keyboard-input') as HTMLInputElement;

let lastX = 0;
let lastY = 0;
let isTouching = false;
let startTouchTime = 0;
let moveCount = 0;
let fingerCount = 0;

// Advanced state
let lastTapTime = 0;
let isDragging = false;
let dragTimeout: any = null;

// Movement buffer for animation frame
let pendingDx = 0;
let pendingDy = 0;
let pendingScrollY = 0;

function haptic(type: 'light' | 'medium' | 'heavy' = 'light') {
    if (!navigator.vibrate) return;
    if (type === 'light') navigator.vibrate(10);
    else if (type === 'medium') navigator.vibrate(30);
    else if (type === 'heavy') navigator.vibrate(60);
}

function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = window.location.port === '3005' 
        ? `${protocol}//${window.location.hostname}:3005/ws`
        : `${protocol}//${window.location.host}`;
    
    console.log("Connecting to:", wsUrl);
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        statusText.innerText = 'Connected';
        statusContainer.classList.add('connected');
        haptic('medium');
    };

    socket.onclose = () => {
        statusText.innerText = 'Disconnected';
        statusContainer.classList.remove('connected');
        // Auto-reconnect
        setTimeout(connect, 3000);
    };

    socket.onerror = (error) => {
        console.error('WebSocket Error:', error);
    };
}

function emit(payload: RemoteEvent) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(payload));
    }
}

connect();

sensitivitySlider.addEventListener('input', (e) => {
    const val = (e.target as HTMLInputElement).value;
    sensitivityVal.innerText = `${val}x`;
});

sessionToggle.addEventListener('click', () => {
    haptic('light');
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close();
    } else {
        connect();
    }
});

keyboardToggle.addEventListener('click', () => {
    haptic('light');
    const isActive = keyboardContainer.classList.toggle('active');
    if (isActive) {
        keyboardInput.focus();
    } else {
        keyboardInput.blur();
    }
});

keyboardInput.addEventListener('input', (e) => {
    const text = (e.target as HTMLInputElement).value;
    if (text.length > 0) {
        emit({ event: 'keyboardType', data: { text } });
        (e.target as HTMLInputElement).value = '';
        haptic('light');
    }
});

keyboardInput.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace') {
        emit({ event: 'keyboardTap', data: { key: 'backspace' } });
        haptic('light');
    } else if (e.key === 'Enter') {
        emit({ event: 'keyboardTap', data: { key: 'enter' } });
        (e.target as HTMLInputElement).value = '';
        haptic('medium');
    }
});

// High-frequency update loop
function update() {
    const sensitivity = parseFloat(sensitivitySlider.value);
    
    if (pendingDx !== 0 || pendingDy !== 0) {
        const event = isDragging ? 'mouseDrag' : 'mouseMove';
        emit({ event, data: { dx: pendingDx * sensitivity, dy: pendingDy * sensitivity } } as RemoteEvent);
        pendingDx = 0;
        pendingDy = 0;
    }
    
    if (pendingScrollY !== 0) {
        emit({ event: 'mouseScroll', data: { deltaY: pendingScrollY * sensitivity } });
        pendingScrollY = 0;
    }
    
    requestAnimationFrame(update);
}
requestAnimationFrame(update);

touchpad.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    isTouching = true;
    touchpad.style.background = 'radial-gradient(circle at center, #3a3a3a 0%, #121212 100%)'; 
    fingerCount = e.touches.length;
    
    const touch = e.touches[0];
    lastX = touch.clientX;
    lastY = touch.clientY;
    
    startTouchTime = Date.now();
    moveCount = 0;

    if (fingerCount === 1) {
        dragTimeout = setTimeout(() => {
            if (moveCount < 5 && isTouching) {
                isDragging = true;
                emit({ event: 'mouseDown', data: { button: 'left' } });
                touchpad.style.background = 'radial-gradient(circle at center, #007aff44 0%, #121212 100%)'; 
                haptic('heavy');
            }
        }, 500);
    }
});

touchpad.addEventListener('touchmove', (e) => {
    if (!isTouching || !socket || socket.readyState !== WebSocket.OPEN) return;
    e.preventDefault();
    
    const touch = e.touches[0];
    const dx = touch.clientX - lastX;
    const dy = touch.clientY - lastY;
    
    lastX = touch.clientX;
    lastY = touch.clientY;
    
    moveCount++;
    
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
        emit({ event: 'mouseUp', data: { button: 'left' } });
        isDragging = false;
        haptic('light');
    } else if (socket && socket.readyState === WebSocket.OPEN && duration < 300 && moveCount < 10) {
        if (fingerCount === 1) {
            if (now - lastTapTime < 300) {
                emit({ event: 'mouseClick', data: { button: 'left', double: true } });
                lastTapTime = 0;
                haptic('medium');
            } else {
                emit({ event: 'mouseClick', data: { button: 'left' } });
                lastTapTime = now;
                haptic('light');
            }
        } else if (fingerCount === 2) {
            emit({ event: 'mouseClick', data: { button: 'right' } });
            haptic('medium');
        }
    }
    
    if (e.touches.length === 0) {
        isTouching = false;
        touchpad.style.background = 'radial-gradient(circle at center, #252525 0%, #121212 100%)'; 
        fingerCount = 0;
        pendingDx = 0;
        pendingDy = 0;
        pendingScrollY = 0;
    } else {
        fingerCount = e.touches.length;
    }
});
