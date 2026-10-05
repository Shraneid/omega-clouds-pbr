export const getRandomInt = (max: number) => {
    return Math.floor(Math.random() * max);
};

// MATRIX + VECTOR FUNCTIONS
export const mat4Perspective = (
    fovY: number,
    aspect: number,
    near: number,
    far: number,
) => {
    const f = 1.0 / Math.tan(fovY / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
        f / aspect,
        0,
        0,
        0,
        0,
        f,
        0,
        0,
        0,
        0,
        (far + near) * nf,
        -1,
        0,
        0,
        2 * far * near * nf,
        0,
    ]);
};

export const mat4LookAt = (
    eye: [number, number, number],
    target: [number, number, number],
    up: [number, number, number],
) => {
    const z = normalize(sub(eye, target)); // forward
    const x = normalize(cross(up, z)); // right
    const y = cross(z, x); // up
    return new Float32Array([
        x[0],
        y[0],
        z[0],
        0,
        x[1],
        y[1],
        z[1],
        0,
        x[2],
        y[2],
        z[2],
        0,
        -dot(x, eye),
        -dot(y, eye),
        -dot(z, eye),
        1,
    ]);
};

export const sub = (a: number[], b: number[]) =>
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]] as [number, number, number];
export const dot = (a: number[], b: number[]) =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: number[], b: number[]): [number, number, number] => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
];
export const normalize = (a: number[]): [number, number, number] => {
    const l = Math.sqrt(dot(a, a));
    return [a[0] / l, a[1] / l, a[2] / l];
};
