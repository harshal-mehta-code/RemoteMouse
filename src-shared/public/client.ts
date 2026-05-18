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

const pinOverlay = document.getElementById('pin-overlay') as HTMLElement;
const pinInput = document.getElementById('pin-input') as HTMLInputElement;
const authBtn = document.getElementById('auth-btn') as HTMLElement;
const authStatus = document.getElementById('auth-status') as HTMLElement;

let lastX = 0;
let lastY = 0;
let startX = 0;
let startY = 0;
let isTouching = false;
let startTouchTime = 0;
let lastTouchTime = 0;
let moveCount = 0;
let fingerCount = 0;
let isAuthenticated = false;

// Advanced state
let lastTapTime = 0;
let isDragging = false;
let dragTimeout: any = null;

// Movement buffer for animation frame
let pendingDx = 0;
let pendingDy = 0;
let pendingScrollY = 0;

// Sub-pixel accumulator
let remainderDx = 0;
let remainderDy = 0;

// Pinch zoom state
let lastPinchDistance = 0;
let pendingZoom = 0;
let lastTouch1: {x: number, y: number} | null = null;
let lastTouch2: {x: number, y: number} | null = null;

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
        statusText.innerText = 'Connecting...';
        statusContainer.classList.add('connected');
        haptic('medium');
    };

    socket.onmessage = (event) => {
        try {
            const payload = JSON.parse(event.data);
            if (payload.event === 'auth_success') {
                isAuthenticated = true;
                pinOverlay.classList.add('hidden');
                statusText.innerText = 'Connected';
                haptic('medium');
            } else if (payload.event === 'auth_error') {
                authStatus.innerText = payload.data.message;
                authStatus.className = 'error';
                haptic('heavy');
            }
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    };

    socket.onclose = () => {
        statusText.innerText = 'Disconnected';
        statusContainer.classList.remove('connected');
        isAuthenticated = false;
        pinOverlay.classList.remove('hidden');
        // Auto-reconnect
        setTimeout(connect, 3000);
    };

    socket.onerror = (error) => {
        console.error('WebSocket Error:', error);
    };
}

function emit(payload: RemoteEvent) {
    if (socket && socket.readyState === WebSocket.OPEN && (isAuthenticated || payload.event === 'auth')) {
        socket.send(JSON.stringify(payload));
    }
}

connect();

authBtn.addEventListener('click', () => {
    const pin = pinInput.value;
    if (pin.length === 4) {
        emit({ event: 'auth', data: { pin } });
        authStatus.innerText = 'Verifying...';
        authStatus.className = '';
    } else {
        authStatus.innerText = 'Enter 4 digits';
        authStatus.className = 'error';
    }
});

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
        
        const rawDx = (pendingDx * sensitivity) + remainderDx;
        const rawDy = (pendingDy * sensitivity) + remainderDy;
        
        const intDx = Math.round(rawDx);
        const intDy = Math.round(rawDy);
        
        remainderDx = rawDx - intDx;
        remainderDy = rawDy - intDy;

        if (intDx !== 0 || intDy !== 0) {
            emit({ event, data: { dx: intDx, dy: intDy } } as RemoteEvent);
        }
        
        pendingDx = 0;
        pendingDy = 0;
    }
    
    if (pendingScrollY !== 0) {
        emit({ event: 'mouseScroll', data: { deltaY: pendingScrollY * sensitivity } });
        pendingScrollY = 0;
    }
    
    if (Math.abs(pendingZoom) > 15) {
        // Send in discrete chunks to avoid spamming the modifier keys on the backend
        emit({ event: 'pinchZoom', data: { delta: Math.round(pendingZoom) } });
        pendingZoom = 0;
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
    startX = touch.clientX;
    startY = touch.clientY;
    
    startTouchTime = Date.now();
    lastTouchTime = Date.now();
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
    } else if (fingerCount === 2) {
        lastPinchDistance = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
        );
        lastTouch1 = {x: e.touches[0].clientX, y: e.touches[0].clientY};
        lastTouch2 = {x: e.touches[1].clientX, y: e.touches[1].clientY};
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
    } else if (e.touches.length === 2 && lastTouch1 && lastTouch2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        
        const dx1 = t1.clientX - lastTouch1.x;
        const dy1 = t1.clientY - lastTouch1.y;
        const dx2 = t2.clientX - lastTouch2.x;
        const dy2 = t2.clientY - lastTouch2.y;
        
        const dotProduct = (dx1 * dx2) + (dy1 * dy2);
        
        if (dotProduct < 0) {
            // Moving in opposite directions: PINCH
            const newDistance = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
            const pinchDelta = newDistance - lastPinchDistance;
            
            if (Math.abs(pinchDelta) > 1) {
                pendingZoom += pinchDelta;
                lastPinchDistance = newDistance;
            }
        } else {
            // Moving in same direction: SCROLL
            const avgDy = (dy1 + dy2) / 2;
            
            const now = Date.now();
            const dt = now - lastTouchTime;
            
            let multiplier = 1;
            if (dt > 0 && dt < 50) { 
                const velocity = Math.abs(avgDy) / dt;
                if (velocity > 0.5) {
                    multiplier = 1 + (velocity - 0.5) * 3;
                    multiplier = Math.min(multiplier, 5);
                }
            }
            
            pendingScrollY += avgDy * multiplier;
            // Update pinch distance so we don't jump if they switch back to pinching
            lastPinchDistance = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        }
        
        lastTouch1 = {x: t1.clientX, y: t1.clientY};
        lastTouch2 = {x: t2.clientX, y: t2.clientY};
    }
    
    lastTouchTime = Date.now();
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
    const distance = Math.hypot(lastX - startX, lastY - startY);
    
    if (isDragging) {
        emit({ event: 'mouseUp', data: { button: 'left' } });
        isDragging = false;
        haptic('light');
    } else if (socket && socket.readyState === WebSocket.OPEN && duration < 300 && distance < 10) {
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
        pendingZoom = 0;
        lastTouch1 = null;
        lastTouch2 = null;
    } else {
        fingerCount = e.touches.length;
    }
});
