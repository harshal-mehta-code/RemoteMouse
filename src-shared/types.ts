export type MouseButton = 'left' | 'right' | 'middle';

export interface MouseMoveData {
    dx: number;
    dy: number;
}

export interface MouseClickData {
    button: MouseButton;
    double?: boolean;
}

export interface MouseScrollData {
    deltaY: number;
}

export interface KeyboardTypeData {
    text: string;
}

export interface KeyboardTapData {
    key: string;
}

export interface AuthData {
    pin: string;
}

export interface PinchZoomData {
    delta: number;
}

export type RemoteEvent = 
    | { event: 'auth'; data: AuthData }
    | { event: 'auth_success'; data?: any }
    | { event: 'auth_error'; data: { message: string } }
    | { event: 'mouseMove'; data: MouseMoveData }
    | { event: 'mouseDrag'; data: MouseMoveData }
    | { event: 'mouseClick'; data: MouseClickData }
    | { event: 'mouseDown'; data: MouseClickData }
    | { event: 'mouseUp'; data: MouseClickData }
    | { event: 'mouseScroll'; data: MouseScrollData }
    | { event: 'keyboardType'; data: KeyboardTypeData }
    | { event: 'keyboardTap'; data: KeyboardTapData }
    | { event: 'pinchZoom'; data: PinchZoomData };

export interface ConnectionInfo {
    url: string;
    qrCodeDataUrl?: string;
}
