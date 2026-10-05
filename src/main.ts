import "./style.css";
import { mat4LookAt, mat4Perspective } from "./helper.ts";

const params = new URLSearchParams(window.location.search);
const DISTANCE_TO_CUBE = parseFloat(params.get("distance") ?? "2.2");

let startTime: number;
let lastFrameTime: number;

const yaw = 0;
const pitch = 0.2;
let mouseDown = false;
let mousePos = { x: 0, y: 0 };
let mouseDelta = { x: 0, y: 0 };

// getting the HTML canvas
const canvas: HTMLCanvasElement = document.getElementById(
    "GLCanvas",
)! as HTMLCanvasElement;

// SETTING UP MOUSE MOVEMENT
canvas.addEventListener("mousedown", () => {
    mouseDown = true;
});
canvas.addEventListener("mouseup", () => {
    mouseDown = false;
    mouseDelta = { x: 0, y: 0 };
});
canvas.addEventListener("mousemove", (e) => {
    if (!mouseDown) {
        mousePos = { x: -1, y: -1 };
        return;
    }
    const rect = canvas.getBoundingClientRect();

    mouseDelta = { x: e.movementX / rect.width, y: -e.movementY / rect.width };
    mousePos = { x: e.offsetX / rect.width, y: 1 - e.offsetY / rect.width };
});

// SETTING UP TOUCH INPUT
let lastTouchPos = { x: 0, y: 0 };
canvas.addEventListener(
    "touchstart",
    (e) => {
        e.preventDefault();
        mouseDown = true;
        const rect = canvas.getBoundingClientRect();
        const touch = e.touches[0];
        lastTouchPos = { x: touch.clientX, y: touch.clientY };
        mousePos = {
            x: (touch.clientX - rect.left) / rect.width,
            y: 1 - (touch.clientY - rect.top) / rect.height,
        };
    },
    { passive: false },
);

canvas.addEventListener(
    "touchend",
    (e) => {
        e.preventDefault();
        mouseDown = false;
        mouseDelta = { x: 0, y: 0 };
    },
    { passive: false },
);

canvas.addEventListener(
    "touchmove",
    (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const touch = e.touches[0];
        mouseDelta = {
            x: (touch.clientX - lastTouchPos.x) / rect.width,
            y: -(touch.clientY - lastTouchPos.y) / rect.height,
        };
        mousePos = {
            x: (touch.clientX - rect.left) / rect.width,
            y: 1 - (touch.clientY - rect.top) / rect.height,
        };
        lastTouchPos = { x: touch.clientX, y: touch.clientY };
    },
    { passive: false },
);

// MAIN SETUP FOR RENDERING
const adapter = await navigator.gpu?.requestAdapter();
const device = await adapter?.requestDevice();

if (!device) {
    throw Error("No gpu detected");
}

const context = canvas.getContext("webgpu");
if (!context) {
    throw Error("Error getting the context");
}

const devicePixelRatio = window.devicePixelRatio;
canvas.width = canvas.clientWidth * devicePixelRatio;
canvas.height = canvas.clientHeight * devicePixelRatio;

const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
context.configure({
    device: device,
    format: presentationFormat,
});
// END MAIN SETUP FOR RENDERING

// LOAD TEXTURES
const loadTextureToBitmap = async (path: string) => {
    const textureResponse = await fetch(path);
    const textureBlob = await textureResponse.blob();

    return await createImageBitmap(textureBlob);
};

const getTexture = async (path: string, label: string) => {
    const bitmap = await loadTextureToBitmap(path);

    const texture = device.createTexture({
        label,
        size: [bitmap.width, bitmap.height, 1],
        format: "rgba8unorm",
        usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.RENDER_ATTACHMENT,
    });

    device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [
        bitmap.width,
        bitmap.height,
    ]);

    return texture;
};

// LOAD SHADERS
const loadWGSL = async (path: string) => {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
        throw new Error(`Failed to load shader: ${path}`);
    }
    return response.text();
};

const loadShaderModule = async (path: string): Promise<GPUShaderModule> => {
    const code = await loadWGSL(path);
    const module = device.createShaderModule({ code, label: path });

    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((m) => m.type === "error");
    if (errors.length > 0) {
        for (const m of errors) {
            console.error(
                `%c${path}:${m.lineNum}:${m.linePos} ${m.message}`,
                "color:#ff5555",
            );
        }
        throw new Error(
            `Shader compilation failed in ${path}:\n` +
                errors
                    .map((m) => `  ${m.lineNum}:${m.linePos} ${m.message}`)
                    .join("\n"),
        );
    }
    return module;
};

const vertexShader = await loadShaderModule("shaders/vertex.wgsl");
const fragmentShader = await loadShaderModule("shaders/fragment.wgsl");
const postProcessShader = await loadShaderModule("shaders/postProcess.wgsl");
// END LOAD SHADERS

// BUFFERS
const uniformBuffer = device.createBuffer({
    label: "Uniform Buffer",
    size: 160, // 152 + 8 padding, rounded at 16 bytes
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
// END BUFFERS

// LOAD TEXTURES
const linearSampler = device.createSampler({
    minFilter: "linear",
    magFilter: "linear",
    addressModeU: "repeat",
    addressModeV: "repeat",
});
const postProcessSampler = device.createSampler({
    minFilter: "linear",
    magFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
});

const mainNoiseTexture = await getTexture(
    "textures/noise.png",
    "mainNoiseTexture",
);

const blueNoiseTexture = await getTexture(
    "textures/blueNoise.png",
    "blueNoiseTexture",
);
// END LOAD TEXTURES

// RENDER TARGET
const RENDER_SCALE = parseFloat(params.get("scale") ?? "0.5");

const scaleSelect = document.getElementById("renderScale") as HTMLSelectElement;
scaleSelect.value = String(RENDER_SCALE);
scaleSelect.addEventListener("change", () => {
    params.set("scale", scaleSelect.value);
    window.location.search = params.toString();
});

const renderTargetSize = {
    width: canvas.width * RENDER_SCALE,
    height: canvas.height * RENDER_SCALE,
};

const sceneTexture = device.createTexture({
    label: "",
    size: [renderTargetSize.width, renderTargetSize.height],
    format: presentationFormat,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
});
// END RENDER TARGET

// BIND GROUP LAYOUTS
const renderBindGroupLayout = device.createBindGroupLayout({
    label: "Render Bind Group Layout",
    entries: [
        {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: "uniform" },
        },
        {
            binding: 1,
            visibility: GPUShaderStage.FRAGMENT,
            sampler: {},
        },
        {
            binding: 2,
            visibility: GPUShaderStage.FRAGMENT,
            texture: {},
        },
        {
            binding: 3,
            visibility: GPUShaderStage.FRAGMENT,
            texture: {},
        },
    ],
});

const postProcessBindGroupLayout = device.createBindGroupLayout({
    label: "Post Process Bind Group Layout",
    entries: [
        {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: "uniform" },
        },
        {
            binding: 1,
            visibility: GPUShaderStage.FRAGMENT,
            sampler: {},
        },
        {
            binding: 2,
            visibility: GPUShaderStage.FRAGMENT,
            texture: {},
        },
    ],
});
// END BIND GROUP LAYOUTS

// PIPELINES SETUP
const renderPipelineLayout = device.createPipelineLayout({
    label: "Render Pipeline Layout",
    bindGroupLayouts: [renderBindGroupLayout],
});

const renderPipeline = device.createRenderPipeline({
    label: "Render Pipeline",
    layout: renderPipelineLayout,
    primitive: {
        topology: "triangle-list",
        cullMode: "none",
    },
    vertex: {
        module: vertexShader,
    },
    fragment: {
        module: fragmentShader,
        targets: [
            {
                format: presentationFormat,
                blend: {
                    color: {
                        srcFactor: "src-alpha",
                        dstFactor: "one-minus-src-alpha",
                        operation: "add",
                    },
                    alpha: {
                        srcFactor: "one",
                        dstFactor: "one-minus-src-alpha",
                        operation: "add",
                    },
                },
            },
        ],
    },
});

const postProcessPipelineLayout = device.createPipelineLayout({
    label: "Post Process Pipeline Layout",
    bindGroupLayouts: [postProcessBindGroupLayout],
});

const postProcessPipeline = device.createRenderPipeline({
    label: "Post Process Pipeline",
    layout: postProcessPipelineLayout,
    primitive: {
        topology: "triangle-list",
        cullMode: "none",
    },
    vertex: {
        module: vertexShader,
    },
    fragment: {
        module: postProcessShader,
        targets: [
            {
                format: presentationFormat,
                blend: undefined,
            },
        ],
    },
});

// BIND GROUPS
const renderBindGroup = device.createBindGroup({
    label: "Render Bind Group",
    layout: renderBindGroupLayout,
    entries: [
        {
            binding: 0,
            resource: { buffer: uniformBuffer },
        },
        {
            binding: 1,
            resource: linearSampler,
        },
        {
            binding: 2,
            resource: mainNoiseTexture.createView(),
        },
        {
            binding: 3,
            resource: blueNoiseTexture.createView(),
        },
    ],
});

const postProcessBindGroup = device.createBindGroup({
    label: "Post Processing Bind Group",
    layout: postProcessBindGroupLayout,
    entries: [
        {
            binding: 0,
            resource: { buffer: uniformBuffer },
        },
        {
            binding: 1,
            resource: postProcessSampler,
        },
        {
            binding: 2,
            resource: sceneTexture.createView(),
        },
    ],
});

// Render Pass Descriptors
const renderPassDescriptor = {
    label: "Render Pass Description",
    colorAttachments: [
        {
            view: sceneTexture.createView(),
            clearValue: [0, 0, 0, 1],
            loadOp: "clear",
            storeOp: "store",
        },
    ],
};

const postProcessPassDescriptor = {
    label: "Post Process Pass Description",
    colorAttachments: [
        {
            clearValue: [0, 0, 0, 1],
            loadOp: "clear",
            storeOp: "store",
            view: context.getCurrentTexture().createView(),
        },
    ],
};
// END PIPELINES SETUP

// SENDING BUFFERS TO GPU

// RENDER
const render = (deltaTime: number, elapsedTime: number, frameCount: number) => {
    postProcessPassDescriptor.colorAttachments[0].view = context
        .getCurrentTexture()
        .createView();

    const encoder = device.createCommandEncoder({ label: "command encoder" });

    // MVP Matrices setup
    const aspect = canvas.width / canvas.height;

    // CAMERA
    const angle = elapsedTime / 1000;
    const cameraPos: [number, number, number] = [
        0,
        // Math.sin(angle) * 5.0,
        0.0, 5.0,
    ];
    // const cameraPos: [number, number, number] = [
    //     Math.sin(angle) * DISTANCE_TO_CUBE,
    //     0.5,
    //     Math.cos(angle) * DISTANCE_TO_CUBE,
    // ];

    // MVP Matrices
    const view = mat4LookAt(cameraPos, [0, 0, 0], [0, 1, 0]);
    const projection = mat4Perspective(Math.PI / 4, aspect, 0.1, 1000.0);

    // UNIFORMS
    device.queue.writeBuffer(uniformBuffer, 0, view);
    device.queue.writeBuffer(uniformBuffer, 64, projection);
    device.queue.writeBuffer(
        uniformBuffer,
        128,
        new Float32Array([...cameraPos, 0]),
    );
    device.queue.writeBuffer(
        uniformBuffer,
        144,
        new Float32Array([deltaTime / 1000, elapsedTime]),
    );
    device.queue.writeBuffer(
        uniformBuffer,
        152,
        new Float32Array([frameCount]),
    );

    // RENDER PASS
    // @ts-ignore
    const renderPass = encoder.beginRenderPass(renderPassDescriptor);
    renderPass.setPipeline(renderPipeline);
    renderPass.setBindGroup(0, renderBindGroup);
    renderPass.draw(3);
    renderPass.end();

    // @ts-ignore
    const postProcessPass = encoder.beginRenderPass(postProcessPassDescriptor);
    postProcessPass.setPipeline(postProcessPipeline);
    postProcessPass.setBindGroup(0, postProcessBindGroup);
    postProcessPass.draw(3);
    postProcessPass.end();

    device.queue.submit([encoder.finish()]);
};

let frameCount = 0;

const renderLoop = (timestamp: number) => {
    if (startTime === undefined) {
        startTime = timestamp;
        lastFrameTime = timestamp;
    }
    const elapsedTime = timestamp - startTime;
    const deltaTime = timestamp - lastFrameTime;

    render(deltaTime, elapsedTime, frameCount);

    lastFrameTime = timestamp;
    console.log("looping");
    frameCount += 1;
    requestAnimationFrame(renderLoop);
};

requestAnimationFrame(renderLoop);
// END RENDER
