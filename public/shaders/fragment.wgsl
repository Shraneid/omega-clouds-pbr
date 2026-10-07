const ABSORPTION_COEFFICIENT: f32 = 0.7;
const ANISOTROPIC_COEFFICIENT: f32 = 0.9;
const ANIMATED: f32 = 1.0f; // TRUE
//const ANIMATED: f32 = 0.0f; // FALSE

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
@group(0) @binding(2) var noiseTexture: texture_2d<f32>;
@group(0) @binding(3) var blueNoiseTexture: texture_2d<f32>;

struct VertexOut {
    @builtin(position) pos: vec4f,
    @location(0) uv: vec2f,
};

fn rotateXY(p: vec3f, a: f32) -> vec3f {
    let c = cos(a);
    let s = sin(a);
    return vec3f(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
}

fn rotateYZ(p: vec3f, a: f32) -> vec3f {
    let c = cos(a);
    let s = sin(a);
    return vec3f(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}

fn rotateXZ(p: vec3f, a: f32) -> vec3f {
    let c = cos(a);
    let s = sin(a);
    return vec3f(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
}

fn noise(x: vec3f) -> f32 {
    const offset = vec2(37.0, 239.0);

    let p = floor(x);
    var f = fract(x);
    f = f * f * (3.0 - 2.0 * f);

    let uv = (p.xy + offset * p.z) + f.xy;
    let texSample = textureSampleLevel(noiseTexture, texSampler, (uv + 0.5) / 256.0, 0.0);

    return mix(texSample.g, texSample.r, f.z) * 2.0 - 1.0;
}

fn fbm(p: vec3f) -> f32 {
    var q = p + uniforms.elapsedTime * 0.0003 * vec3(1.0, -0.2, -1.0) * ANIMATED;

    var f = 0.0f;
    var scale = 0.5f;
    var factor = 2.02f;

    for (var i = 0; i < 6; i++) {
        f += scale * noise(q);
        q *= factor;
        factor += 0.21;
        scale *= 0.5;
    }

    return f;
}

fn sdSphere(a:vec3f, b: vec3f, radius: f32) -> f32 {
    return length(b-a) - radius;
};

fn sdTorus(p: vec3f, t: vec2f) -> f32 {
    let q = vec2(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}

fn sdOctahedron(p: vec3f, s: f32) -> f32 {
    let p1 = abs(p);
    return (p1.x+p1.y+p1.z-s) * 0.57735027;
}

fn sdVerticalCapsule(p: vec3f, h: f32, r: f32) -> f32 {
  let p1 = p - vec3(0.0, clamp(p.y, 0.0, h), 0.0);
  return length( p1 ) - r;
}

fn sdCapsule(p: vec3f, a: vec3f, b: vec3f, r: f32) -> f32 {
    let pa = p - a;
    let ba = b - a;
    let h = clamp( dot(pa,ba)/dot(ba,ba), 0.0, 1.0 );
    return length( pa - ba*h ) - r;
}

// animated transitions
//fn scene(p: vec3f) -> f32 {
//    let d1 = sdTorus(p, vec2(1.3, 0.8));
//    let d2 = sdOctahedron(p, 2.0);
//    let d3 = sdVerticalCapsule(p, 2.0, 0.5);
//    let d4 = sdCapsule(p, vec3(0.0, -1., 0.0), vec3(0.0, 1., 0.0), 0.5);
//
//    let f = fbm(p);
//
//    let step1 = min(d1, d4);
//    let step2 = d2;
//    let step3 = d3;
//
//    let elapsedSeconds = uniforms.elapsedTime * 0.001;
//    let numTransitions = 3.0;
//    let stepDuration = 2.0;
//    let cyclePos = (elapsedSeconds % (numTransitions * stepDuration)) / stepDuration;
//
//    let transitionIdx = floor(cyclePos);            // 0 or 1
//    let m = smoothstep(0.6, 1.0, fract(cyclePos));  // 0..1 within this transition
//
//    var start = 0.0;
//    var end = 0.0;
//    if (transitionIdx == 0.0) {
//        start = step1;
//        end   = step2;
//    } else if (transitionIdx == 1.0) {
//        start = step2;
//        end   = step3;
//    } else if (transitionIdx == 2.0) {
//        start = step3;
//        end   = step1;
//    }
//    var distance = mix(start, end, m);
//
//    return - distance + f;
//}

fn scene(p: vec3f) -> f32 {
    let sphere = vec4f(0.0, 0.0, 0.0, 1.0);
    let sphereDistance = sdSphere(p, sphere.xyz, sphere.w);

    let f = fbm(p);

    return - sphereDistance + f;
}

fn sampleDepth(p: vec3f) -> f32 {
    return max(scene(p), 0.0);
}

fn henyeyGreenstein(mu: f32) -> f32 {
    let g = ANISOTROPIC_COEFFICIENT;
    let gg = g*g;
    return (1.0 / (4.0 * 3.14159265)) * ((1.0 - gg) / pow(1.0 + gg - 2.0 * g * mu, 1.5));
}

fn beersLaw(dist: f32, absorption: f32) -> f32 {
    return exp(-dist * absorption);
}

fn lightRayMarch(rayOrigin: vec3f, sunDirection: vec3f) -> f32 {
    const LIGHT_MAX_STEPS: i32 = 6;
    const LIGHT_MARCH_SIZE = 0.03;

    var position = rayOrigin;
    var totalDensity = 0.0;

    for (var step = 0; step < LIGHT_MAX_STEPS; step++) {
        position += sunDirection * LIGHT_MARCH_SIZE * f32(step);

        let lightSample = sampleDepth(position);
        totalDensity += lightSample;
    }

    let transmittance = beersLaw(totalDensity, ABSORPTION_COEFFICIENT);
    return transmittance;
}

fn rayMarch(rayOrigin: vec3f, rayDirection: vec3f, sunDirection: vec3f) -> vec4f {
    const MARCH_SIZE: f32 = 0.16f;
    const MAX_STEPS: i32 = 40;

    var currentPosition = rayOrigin;
    var transmittance = 1.0;
    var luminance = vec3(0.0);

    for (var i = 0; i < MAX_STEPS; i++) {
        let density = sampleDepth(currentPosition);

        if (density > 0.0) {
            let phase = 1.0; // TODO: change later
            // TODO: LIGHT MARCH

            let stepTransmittance = beersLaw(MARCH_SIZE, ABSORPTION_COEFFICIENT);

            luminance += vec3(1.0 - transmittance);
            transmittance *= stepTransmittance;
        }

        currentPosition += MARCH_SIZE * normalize(rayDirection);
    }

    return vec4(luminance, transmittance);
}

fn applyCameraRotation(p: vec3f) -> vec3f {
    let angle = uniforms.elapsedTime * 0.000;
    let p2 = rotateXZ(p, angle);
    return p2;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
    var sunPosition: vec3f = vec3(2.0, 1.5, -2.5);
    var sunDirection: vec3f = normalize(sunPosition);

    var uv = vec2f(in.uv);
    var centeredUV = uv - vec2f(0.5);

    var camera = uniforms.cameraPosition.xyz;
    let forward = normalize(-camera);
    let up = vec3(0.0, 1.0, 0.0);
    let right  = normalize(cross(forward, up));
    let fov = 1.0;

    let rayDirection = normalize(forward + (right * centeredUV.x + up * centeredUV.y) * fov);

    var offset = fract(textureSampleLevel(blueNoiseTexture, texSampler, in.pos.xy / 1024.0, 0.0).r);
    offset = fract(offset + f32(u32(uniforms.frameCount) % 32u) * 1.618);

    let cloudColorAndTransmittance = rayMarch(camera + rayDirection * offset, rayDirection, sunDirection);

    let luminance = cloudColorAndTransmittance.rgb;
    let transmittance = cloudColorAndTransmittance.a;

    let sunAlbedo = max(vec3(pow(dot(sunDirection, rayDirection), 30.0)), vec3(0,0,0));
    let sunColor = vec3(255., 200., 120.) / 255.0;
//    let sunColor = vec3(1.0, 0.6, 0.3);
    var skyColor = vec3(0.7, 0.7, 0.9);
    skyColor -= 0.5 * vec3(0.9, 0.75, 0.9) * centeredUV.y;

    let sun = clamp(dot(sunDirection, rayDirection), 0.0, 1.0);

    skyColor += sunAlbedo;

    let color = skyColor * transmittance + sunColor * luminance;
    return vec4(color.rgb, 1.0);
}