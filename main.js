import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- VEHICLE CONFIGURATION ---
const CONFIG = {
    mass: 1450,               // kg
    gravity: 9.81,
    dragCoeff: 0.29,          // Aerodynamic drag
    rollingResist: 0.015,
    engineTorqueMax: 450,     // Nm
    gearRatios: [3.6, 2.3, 1.6, 1.2, 0.9], // 5-speed
    finalDrive: 3.42,
    wheelRadius: 0.33,        // meters
    wheelBase: 2.65,          // distance front to back wheels
    trackWidth: 1.6,          // distance left to right wheels
    cgHeight: 0.55            // Center of Gravity height
};

class Vehicle {
    constructor(scene) {
        this.velocity = new THREE.Vector3();
        this.worldAccel = new THREE.Vector3();
        this.angularVelocity = 0;
        this.rotation = 0;
        this.rpm = 1000;
        this.gear = 0;
        this.inputs = { throttle: 0, brake: 0, steer: 0, handbrake: false };
        
        // Wheel positions relative to CG [FL, FR, RL, RR]
        this.wheels = [
            { pos: new THREE.Vector3(0.8, 0, 1.3), load: 362, slipAngle: 0 },
            { pos: new THREE.Vector3(-0.8, 0, 1.3), load: 362, slipAngle: 0 },
            { pos: new THREE.Vector3(0.8, 0, -1.35), load: 362, slipAngle: 0 },
            { pos: new THREE.Vector3(-0.8, 0, -1.35), load: 362, slipAngle: 0 }
        ];

        this.mesh = null;
        this.loadModel(scene);
    }

    loadModel(scene) {
        const loader = new GLTFLoader();
        loader.load('./models/car.glb', (gltf) => {
            this.mesh = gltf.scene;
            scene.add(this.mesh);
        }, undefined, (error) => console.error("Error loading model:", error));
    }

    update(dt) {
        if (!this.mesh) return;

        // Local Coordinate Vectors
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.mesh.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.mesh.quaternion);
        
        // Project velocity into local space (x: lateral, z: longitudinal)
        const localVelZ = this.velocity.dot(forward);
        const localVelX = this.velocity.dot(right);

        // 1. ENGINE & GEARBOX LOGIC
        this.calculateEngine(localVelZ);
        
        // 2. DYNAMIC WEIGHT TRANSFER
        // Calculate G-forces from previous frame's acceleration
        const lonG = (this.worldAccel.dot(forward)) / CONFIG.gravity;
        const latG = (this.worldAccel.dot(right)) / CONFIG.gravity;
        this.applyWeightTransfer(lonG, latG);

        // 3. TIRE FORCES
        let totalForce = new THREE.Vector3();
        let totalTorque = 0;

        this.wheels.forEach((wheel, i) => {
            const isFront = i < 2;
            const isRear = i >= 2;

            // --- Lateral Force (Cornering) ---
            // Steering only affects front wheels
            const steerAngle = isFront ? this.inputs.steer : 0;
            const wheelV = new THREE.Vector3(localVelX, 0, localVelZ);
            // Add angular velocity component to wheel velocity
            wheelV.x += this.angularVelocity * wheel.pos.z;

            const slipAngle = Math.atan2(wheelV.x, Math.max(0.1, Math.abs(wheelV.z))) - steerAngle;
            // Simplified Pacejka: Force = Load * sin(C * atan(B * slip))
            const latF = -Math.sin(slipAngle * 1.5) * (wheel.load * CONFIG.gravity) * 0.9;

            // --- Longitudinal Force (Drive/Brake) ---
            let lonF = 0;
            if (isRear) { // Rear Wheel Drive
                const engineTorque = this.getTorqueCurve() * this.inputs.throttle;
                const driveTorque = engineTorque * CONFIG.gearRatios[this.gear] * CONFIG.finalDrive;
                lonF = driveTorque / CONFIG.wheelRadius;
            }

            // Braking (70% front bias for stability)
            const brakeForce = this.inputs.brake * 6000 * (isFront ? 0.7 : 0.3);
            const handbrakeForce = (this.inputs.handbrake && isRear) ? 8000 : 0;
            lonF -= (Math.sign(localVelZ) * (brakeForce + handbrakeForce));

            // Accumulate Forces
            const worldWheelF = right.clone().multiplyScalar(latF).add(forward.clone().multiplyScalar(lonF));
            totalForce.add(worldWheelF);

            // Accumulate Torque (Force * distance from CG)
            totalTorque += (latF * wheel.pos.z) - (lonF * wheel.pos.x);
        });

        // 4. ATMOSPHERICS (Drag & Rolling Resistance)
        const airDensity = 1.225;
        const dragForce = -0.5 * airDensity * (localVelZ * localVelZ) * CONFIG.dragCoeff * 2.2 * Math.sign(localVelZ);
        totalForce.add(forward.clone().multiplyScalar(dragForce));
        totalForce.add(this.velocity.clone().multiplyScalar(-CONFIG.mass * CONFIG.rollingResist));

        // 5. PHYSICS INTEGRATION
        this.worldAccel.copy(totalForce.divideScalar(CONFIG.mass));
        this.velocity.addScaledVector(this.worldAccel, dt);
        this.mesh.position.addScaledVector(this.velocity, dt);

        // Rotation (Inertia approximation: 2000)
        const rotAccel = totalTorque / 2000;
        this.angularVelocity += rotAccel * dt;
        this.rotation += this.angularVelocity * dt;
        this.mesh.rotation.y = this.rotation;

        // Friction/Damping to prevent infinite spinning
        this.angularVelocity *= 0.96;
        if (this.velocity.length() < 0.1 && this.inputs.throttle === 0) this.velocity.set(0,0,0);
        
        this.updateHUD(localVelZ);
    }

    calculateEngine(speed) {
        const wheelRot = Math.abs(speed) / CONFIG.wheelRadius;
        this.rpm = (wheelRot * CONFIG.gearRatios[this.gear] * CONFIG.finalDrive * 60) / (2 * Math.PI);
        this.rpm = Math.max(1000, Math.min(7500, this.rpm));

        // Auto Gearbox
        if (this.rpm > 6800 && this.gear < CONFIG.gearRatios.length - 1) this.gear++;
        if (this.rpm < 2500 && this.gear > 0) this.gear--;
    }

    getTorqueCurve() {
        // Mock torque curve: peaks at 4500 RPM
        const rpmNorm = this.rpm / 7500;
        return CONFIG.engineTorqueMax * (1 - Math.pow(rpmNorm - 0.6, 2));
    }

    applyWeightTransfer(axG, ayG) {
        const totalWeight = CONFIG.mass * 0.25; // Base weight per wheel
        const lonShift = (axG * (CONFIG.cgHeight / CONFIG.wheelBase)) * (CONFIG.mass * 0.25);
        const latShift = (ayG * (CONFIG.cgHeight / CONFIG.trackWidth)) * (CONFIG.mass * 0.25);

        this.wheels[0].load = totalWeight - lonShift - latShift; // FL
        this.wheels[1].load = totalWeight - lonShift + latShift; // FR
        this.wheels[2].load = totalWeight + lonShift - latShift; // RL
        this.wheels[3].load = totalWeight + lonShift + latShift; // RR
    }

    updateHUD(speed) {
        const speedKmh = Math.abs(Math.floor(speed * 3.6));
        document.getElementById('speedometer').innerHTML = `${speedKmh} <span>KM/H</span>`;
        document.getElementById('rpm-bar').style.width = `${(this.rpm / 7500) * 100}%`;
        document.getElementById('gear').innerText = `G: ${this.gear + 1}`;
    }
}

// --- THREE.JS SCENE SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x333333);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Lighting
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.position.set(5, 10, 5);
scene.add(sun);

// Floor (Grid for speed reference)
const grid = new THREE.GridHelper(1000, 100, 0xffffff, 0x555555);
scene.add(grid);

const car = new Vehicle(scene);
const clock = new THREE.Clock();

// --- INPUTS ---
const keys = {};
window.addEventListener('keydown', (e) => keys[e.code] = true);
window.addEventListener('keyup', (e) => keys[e.code] = false);

// --- MAIN LOOP ---
function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);

    // Update Inputs
    car.inputs.throttle = keys['ArrowUp'] || keys['KeyW'] ? 1 : 0;
    car.inputs.brake = keys['ArrowDown'] || keys['KeyS'] ? 1 : 0;
    car.inputs.handbrake = keys['Space'];
    
    // Steering with speed sensitivity
    const targetSteer = (keys['ArrowLeft'] || keys['KeyA'] ? 0.5 : 0) - (keys['ArrowRight'] || keys['KeyD'] ? 0.5 : 0);
    const speedFactor = Math.max(0.1, 1.0 - (car.velocity.length() / 60));
    car.inputs.steer = THREE.MathUtils.lerp(car.inputs.steer, targetSteer * speedFactor, 0.1);

    car.update(dt);

    // Smooth Camera
    if (car.mesh) {
        const camOffset = new THREE.Vector3(0, 2.5, -6).applyQuaternion(car.mesh.quaternion);
        const targetCamPos = car.mesh.position.clone().add(camOffset);
        camera.position.lerp(targetCamPos, 0.1);
        camera.lookAt(car.mesh.position.clone().add(new THREE.Vector3(0, 1, 0)));
        
        // Dynamic FOV
        camera.fov = 70 + (car.velocity.length() * 0.4);
        camera.updateProjectionMatrix();
    }

    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();