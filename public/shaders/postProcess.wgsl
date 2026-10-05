struct Uniforms {
    view: mat4x4f,
    projection: mat4x4f,
    cameraPosition: vec4f,
    deltaTime: f32,
    elapsedTime: f32,
    frameCount: f32,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var texSampler: sampler;
@group(0) @binding(2) var sceneTexture: texture_2d<f32>;

struct VertexOut {
    @builtin(position) pos: vec4f,
    @location(0) uv: vec2f,
};

fn cubic_catmull(p0: vec3f, p1: vec3f, p2: vec3f, p3: vec3f, t: f32) -> vec3f {
    let tt = t*t;
    let ttt = tt*t;

    let q0 = -0.5 * ttt + tt - 0.5 * t;
    let q1 = 1.5 * ttt - 2.5 * tt + 1;
    let q2 = -1.5 * ttt + 2 * tt + 0.5 * t;
    let q3 = 0.5 * ttt - 0.5 * tt;

    return p0*q0 + p1*q1 + p2*q2 + p3*q3;
}

fn cubic_bspline(p0: vec3f, p1: vec3f, p2: vec3f, p3: vec3f, t: f32) -> vec3f {
    let tt = t * t;
    let ttt = tt * t;

    let q0 = (1.0 - t) * (1.0 - t) * (1.0 - t) / 6.0;
    let q1 = (3.0 * ttt - 6.0 * tt + 4.0) / 6.0;
    let q2 = (-3.0 * ttt + 3.0 * tt + 3.0 * t + 1.0) / 6.0;
    let q3 = ttt / 6.0;

    return p0*q0 + p1*q1 + p2*q2 + p3*q3;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
    let dimensions = vec2f(textureDimensions(sceneTexture));
    var uv = vec2f(in.uv.x, 1.0 - in.uv.y);
    let coords = uv * dimensions - vec2f(0.5, 0.5);
    let t = fract(coords);
    let base = vec2<i32>(floor(coords));

    let p00 = textureLoad(sceneTexture, base + vec2<i32>(-1, -1), 0).xyz;
    let p01 = textureLoad(sceneTexture, base + vec2<i32>(0, -1), 0).xyz;
    let p02 = textureLoad(sceneTexture, base + vec2<i32>(1, -1), 0).xyz;
    let p03 = textureLoad(sceneTexture, base + vec2<i32>(2, -1), 0).xyz;

    let p0 = cubic_bspline(p00, p01, p02, p03, t.x);

    let p10 = textureLoad(sceneTexture, base + vec2<i32>(-1, 0), 0).xyz;
    let p11 = textureLoad(sceneTexture, base + vec2<i32>(0, 0), 0).xyz;
    let p12 = textureLoad(sceneTexture, base + vec2<i32>(1, 0), 0).xyz;
    let p13 = textureLoad(sceneTexture, base + vec2<i32>(2, 0), 0).xyz;

    let p1 = cubic_bspline(p10, p11, p12, p13, t.x);

    let p20 = textureLoad(sceneTexture, base + vec2<i32>(-1, 1), 0).xyz;
    let p21 = textureLoad(sceneTexture, base + vec2<i32>(0, 1), 0).xyz;
    let p22 = textureLoad(sceneTexture, base + vec2<i32>(1, 1), 0).xyz;
    let p23 = textureLoad(sceneTexture, base + vec2<i32>(2, 1), 0).xyz;

    let p2 = cubic_bspline(p20, p21, p22, p23, t.x);

    let p30 = textureLoad(sceneTexture, base + vec2<i32>(-1, 2), 0).xyz;
    let p31 = textureLoad(sceneTexture, base + vec2<i32>(0, 2), 0).xyz;
    let p32 = textureLoad(sceneTexture, base + vec2<i32>(1, 2), 0).xyz;
    let p33 = textureLoad(sceneTexture, base + vec2<i32>(2, 2), 0).xyz;

    let p3 = cubic_bspline(p30, p31, p32, p33, t.x);

    let color = cubic_bspline(p0, p1, p2, p3, t.y);
//    let color = textureSampleLevel(sceneTexture, texSampler, vec2(uv.x, uv.y), 0.0);

    return vec4(color.rgb, 1.0);
}
