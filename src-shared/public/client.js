"use strict";
(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // src-shared/public/client.ts
  var require_client = __commonJS({
    "src-shared/public/client.ts"() {
      var socket = null;
      var touchpad = document.getElementById("touchpad");
      var statusText = document.getElementById("status");
      var statusContainer = document.getElementById("connection-status");
      var sensitivitySlider = document.getElementById("sensitivity");
      var sensitivityVal = document.getElementById("sensitivity-val");
      var sessionToggle = document.getElementById("session-toggle");
      var keyboardToggle = document.getElementById("keyboard-toggle");
      var keyboardContainer = document.getElementById("keyboard-container");
      var keyboardInput = document.getElementById("keyboard-input");
      var pinOverlay = document.getElementById("pin-overlay");
      var pinInput = document.getElementById("pin-input");
      var authBtn = document.getElementById("auth-btn");
      var authStatus = document.getElementById("auth-status");
      var lastX = 0;
      var lastY = 0;
      var startX = 0;
      var startY = 0;
      var isTouching = false;
      var startTouchTime = 0;
      var lastTouchTime = 0;
      var moveCount = 0;
      var fingerCount = 0;
      var isAuthenticated = false;
      var lastTapTime = 0;
      var isDragging = false;
      var dragTimeout = null;
      var pendingDx = 0;
      var pendingDy = 0;
      var pendingScrollY = 0;
      var remainderDx = 0;
      var remainderDy = 0;
      function haptic(type = "light") {
        if (!navigator.vibrate) return;
        if (type === "light") navigator.vibrate(10);
        else if (type === "medium") navigator.vibrate(30);
        else if (type === "heavy") navigator.vibrate(60);
      }
      function connect() {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = window.location.port === "3005" ? `${protocol}//${window.location.hostname}:3005/ws` : `${protocol}//${window.location.host}`;
        console.log("Connecting to:", wsUrl);
        socket = new WebSocket(wsUrl);
        socket.onopen = () => {
          statusText.innerText = "Connecting...";
          statusContainer.classList.add("connected");
          haptic("medium");
        };
        socket.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            if (payload.event === "auth_success") {
              isAuthenticated = true;
              pinOverlay.classList.add("hidden");
              statusText.innerText = "Connected";
              haptic("medium");
            } else if (payload.event === "auth_error") {
              authStatus.innerText = payload.data.message;
              authStatus.className = "error";
              haptic("heavy");
            }
          } catch (e) {
            console.error("Error parsing message:", e);
          }
        };
        socket.onclose = () => {
          statusText.innerText = "Disconnected";
          statusContainer.classList.remove("connected");
          isAuthenticated = false;
          pinOverlay.classList.remove("hidden");
          setTimeout(connect, 3e3);
        };
        socket.onerror = (error) => {
          console.error("WebSocket Error:", error);
        };
      }
      function emit(payload) {
        if (socket && socket.readyState === WebSocket.OPEN && (isAuthenticated || payload.event === "auth")) {
          socket.send(JSON.stringify(payload));
        }
      }
      connect();
      authBtn.addEventListener("click", () => {
        const pin = pinInput.value;
        if (pin.length === 4) {
          emit({ event: "auth", data: { pin } });
          authStatus.innerText = "Verifying...";
          authStatus.className = "";
        } else {
          authStatus.innerText = "Enter 4 digits";
          authStatus.className = "error";
        }
      });
      sensitivitySlider.addEventListener("input", (e) => {
        const val = e.target.value;
        sensitivityVal.innerText = `${val}x`;
      });
      sessionToggle.addEventListener("click", () => {
        haptic("light");
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.close();
        } else {
          connect();
        }
      });
      keyboardToggle.addEventListener("click", () => {
        haptic("light");
        const isActive = keyboardContainer.classList.toggle("active");
        if (isActive) {
          keyboardInput.focus();
        } else {
          keyboardInput.blur();
        }
      });
      keyboardInput.addEventListener("input", (e) => {
        const text = e.target.value;
        if (text.length > 0) {
          emit({ event: "keyboardType", data: { text } });
          e.target.value = "";
          haptic("light");
        }
      });
      keyboardInput.addEventListener("keydown", (e) => {
        if (e.key === "Backspace") {
          emit({ event: "keyboardTap", data: { key: "backspace" } });
          haptic("light");
        } else if (e.key === "Enter") {
          emit({ event: "keyboardTap", data: { key: "enter" } });
          e.target.value = "";
          haptic("medium");
        }
      });
      function update() {
        const sensitivity = parseFloat(sensitivitySlider.value);
        if (pendingDx !== 0 || pendingDy !== 0) {
          const event = isDragging ? "mouseDrag" : "mouseMove";
          const rawDx = pendingDx * sensitivity + remainderDx;
          const rawDy = pendingDy * sensitivity + remainderDy;
          const intDx = Math.round(rawDx);
          const intDy = Math.round(rawDy);
          remainderDx = rawDx - intDx;
          remainderDy = rawDy - intDy;
          if (intDx !== 0 || intDy !== 0) {
            emit({ event, data: { dx: intDx, dy: intDy } });
          }
          pendingDx = 0;
          pendingDy = 0;
        }
        if (pendingScrollY !== 0) {
          emit({ event: "mouseScroll", data: { deltaY: pendingScrollY * sensitivity } });
          pendingScrollY = 0;
        }
        requestAnimationFrame(update);
      }
      requestAnimationFrame(update);
      touchpad.addEventListener("touchstart", (e) => {
        e.preventDefault();
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        isTouching = true;
        touchpad.style.background = "radial-gradient(circle at center, #3a3a3a 0%, #121212 100%)";
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
              emit({ event: "mouseDown", data: { button: "left" } });
              touchpad.style.background = "radial-gradient(circle at center, #007aff44 0%, #121212 100%)";
              haptic("heavy");
            }
          }, 500);
        }
      });
      touchpad.addEventListener("touchmove", (e) => {
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
          const now = Date.now();
          const dt = now - lastTouchTime;
          let multiplier = 1;
          if (dt > 0 && dt < 50) {
            const velocity = Math.abs(dy) / dt;
            if (velocity > 0.5) {
              multiplier = 1 + (velocity - 0.5) * 3;
              multiplier = Math.min(multiplier, 5);
            }
          }
          pendingScrollY += dy * multiplier;
        }
        lastTouchTime = Date.now();
      });
      touchpad.addEventListener("touchend", (e) => {
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
          emit({ event: "mouseUp", data: { button: "left" } });
          isDragging = false;
          haptic("light");
        } else if (socket && socket.readyState === WebSocket.OPEN && duration < 300 && distance < 10) {
          if (fingerCount === 1) {
            if (now - lastTapTime < 300) {
              emit({ event: "mouseClick", data: { button: "left", double: true } });
              lastTapTime = 0;
              haptic("medium");
            } else {
              emit({ event: "mouseClick", data: { button: "left" } });
              lastTapTime = now;
              haptic("light");
            }
          } else if (fingerCount === 2) {
            emit({ event: "mouseClick", data: { button: "right" } });
            haptic("medium");
          }
        }
        if (e.touches.length === 0) {
          isTouching = false;
          touchpad.style.background = "radial-gradient(circle at center, #252525 0%, #121212 100%)";
          fingerCount = 0;
          pendingDx = 0;
          pendingDy = 0;
          pendingScrollY = 0;
        } else {
          fingerCount = e.touches.length;
        }
      });
    }
  });
  require_client();
})();
