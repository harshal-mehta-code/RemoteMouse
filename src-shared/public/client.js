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
      var lastX = 0;
      var lastY = 0;
      var isTouching = false;
      var startTouchTime = 0;
      var moveCount = 0;
      var fingerCount = 0;
      var lastTapTime = 0;
      var isDragging = false;
      var dragTimeout = null;
      var pendingDx = 0;
      var pendingDy = 0;
      var pendingScrollY = 0;
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
          statusText.innerText = "Connected";
          statusContainer.classList.add("connected");
          haptic("medium");
        };
        socket.onclose = () => {
          statusText.innerText = "Disconnected";
          statusContainer.classList.remove("connected");
          setTimeout(connect, 3e3);
        };
        socket.onerror = (error) => {
          console.error("WebSocket Error:", error);
        };
      }
      function emit(payload) {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(payload));
        }
      }
      connect();
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
          emit({ event, data: { dx: pendingDx * sensitivity, dy: pendingDy * sensitivity } });
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
        startTouchTime = Date.now();
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
          pendingScrollY += dy;
        }
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
        if (isDragging) {
          emit({ event: "mouseUp", data: { button: "left" } });
          isDragging = false;
          haptic("light");
        } else if (socket && socket.readyState === WebSocket.OPEN && duration < 300 && moveCount < 10) {
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
