import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- VEHICLE CONFIGURATION ---
const CONFIG = {
    mass: 1450,
    gravity: 9.81,
    dragCoeff: 0.28,
    rollingResist: 0.012,
    engineTorqueMax: 480,
    gearRatios: [3.6, 2.3, 1.6, 1.2, 0.9],
    finalDrive: 3.65, // Shorter ratio for better acceleration
    wheelRadius: 0.33,
    wheelBase: 2.65,
    trackWidth: 1.6,
    cgHeight: 0.52
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
        
        this.wheels = [
            { pos: new THREE.Vector3(0.8, 0, 1.3), load: 362 },
            { pos: new THREE.Vector3(-0.8, 0, 1.3), load: 362 },
            { pos: new THREE.Vector3(0.8, 0, -1.35), load: 362 },
            { pos: new THREE.Vector3(-0.8, 0, -1.35), load: 362 }
        ];

        this.mesh = null;
        this.loadModel(scene);
    }

    loadModel(scene) {
        const loader = new GLTFLoader();
        loader.load('./models/car.glb', (gltf) => {
            this.mesh = gltf.scene;
            scene.add(this.mesh);
        });
    }

    update(dt) {
        if (!this.mesh) return;

        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.mesh.quaternion);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.mesh.quaternion);
        
        const localVelZ = this.velocity.dot(forward);
        const localVelX = this.velocity.dot(right);

        this.calculateEngine(localVelZ);
        
        const lonG = (this.worldAccel.dot(forward)) / CONFIG.gravity;
        const latG = (this.worldAccel.dot(right)) / CONFIG.gravity;
        this.applyWeightTransfer(lonG, latG);

        let totalForce = new THREE.Vector3();
        let totalTorque = 0;

        this.wheels.forEach((wheel, i) => {
            const isFront = i < 2;
            const isRear = i >= 2;

            // Lateral Force
            const steerAngle = isFront ? this.inputs.steer : 0;
            const wheelV = new THREE.Vector3(localVelX, 0, localVelZ);
            wheelV.x += this.angularVelocity * wheel.pos.z;

            const slipAngle = Math.atan2(wheelV.x, Math.max(0.1, Math.abs(wheelV.z))) - steerAngle;
            const latF = -Math.sin(slipAngle * 1.6) * (wheel.load * CONFIG.gravity) * 1.0; 

            // Longitudinal Force
            let lonF = 0;
            if (isRear) {
                const engineTorque = this.getTorqueCurve() * this.inputs.throttle;
                lonF = (engineTorque * CONFIG.gearRatios[this.gear] * CONFIG.finalDrive) / CONFIG.wheelRadius;
            }

            // --- IMPROVED BRAKING ---
            const brakeForce = this.inputs.brake * 12500 * (isFront ? 0.65 : 0.35);
            const handbrakeForce = (this.inputs.handbrake && isRear) ? 15000 : 0;
            lonF -= (Math.sign(localVelZ) * (brakeForce + handbrakeForce));

            const worldWheelF = right.clone().multiplyScalar(latF).add(forward.clone().multiplyScalar(lonF));
            totalForce.add(worldWheelF);
            totalTorque += (latF * wheel.pos.z) - (lonF * wheel.pos.x);
        });

        // Drag
        const dragForce = -0.5 * 1.225 * (localVelZ * localVelZ) * CONFIG.dragCoeff * 2.2 * Math.sign(localVelZ);
        totalForce.add(forward.clone().multiplyScalar(dragForce));
        totalForce.add(this.velocity.clone().multiplyScalar(-CONFIG.mass * CONFIG.rollingResist));

        // Integration
        this.worldAccel.copy(totalForce.divideScalar(CONFIG.mass));
        this.velocity.addScaledVector(this.worldAccel, dt);
        this.mesh.position.addScaledVector(this.velocity, dt);

        // --- SHARPER ROTATION ---
        const rotAccel = totalTorque / 1100; // Lower denominator = faster rotation
        this.angularVelocity += rotAccel * dt;
        this.rotation += this.angularVelocity * dt;
        this.mesh.rotation.y = this.rotation;

        this.angularVelocity *= 0.94;
        if (this.velocity.length() < 0.1 && this.inputs.throttle === 0) this.velocity.set(0,0,0);
        
        this.updateHUD(localVelZ);
    }

    calculateEngine(speed) {
        const wheelRot = Math.abs(speed) / CONFIG.wheelRadius;
        this.rpm = (wheelRot * CONFIG.gearRatios[this.gear] * CONFIG.finalDrive * 60) / (2 * Math.PI);
        this.rpm = Math.max(1000, Math.min(7500, this.rpm));

        if (this.rpm > 6900 && this.gear < CONFIG.gearRatios.length - 1) this.gear++;
        if (this.rpm < 2800 && this.gear > 0) this.gear--;
    }

    getTorqueCurve() {
        const rpmNorm = this.rpm / 7500;
        return CONFIG.engineTorqueMax * (1 - Math.pow(rpmNorm - 0.65, 2));
    }

    applyWeightTransfer(axG, ayG) {
        const baseW = CONFIG.mass * 0.25;
        const lonShift = (axG * (CONFIG.cgHeight / CONFIG.wheelBase)) * baseW;
        const latShift = (ayG * (CONFIG.cgHeight / CONFIG.trackWidth)) * baseW;

        this.wheels[0].load = baseW - lonShift - latShift;
        this.wheels[1].load = baseW - lonShift + latShift;
        this.wheels[2].load = baseW + lonShift - latShift;
        this.wheels[3].load = baseW + lonShift + latShift;
    }

    updateHUD(speed) {
        const speedKmh = Math.abs(Math.floor(speed * 3.6));
        document.getElementById('speedometer').innerHTML = `${speedKmh} <span>KM/H</span>`;
        document.getElementById('rpm-bar').style.width = `${(this.rpm / 7500) * 100}%`;
        document.getElementById('gear').innerText = `G: ${this.gear + 1}`;
    }
}

// --- SCENE SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(10, 20, 10);
scene.add(sun);

const grid = new THREE.GridHelper(2000, 100, 0xffffff, 0x444444);
scene.add(grid);

const car = new Vehicle(scene);
const clock = new THREE.Clock();

const keys = {};
window.onkeydown = (e) => keys[e.code] = true;
window.onkeyup = (e) => keys[e.code] = false;

function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);

    car.inputs.throttle = keys['ArrowUp'] || keys['KeyW'] ? 1 : 0;
    car.inputs.brake = keys['ArrowDown'] || keys['KeyS'] ? 1 : 0;
    car.inputs.handbrake = keys['Space'];
    
    // --- SHARPER STEERING INPUT ---
    const targetSteer = (keys['ArrowLeft'] || keys['KeyA'] ? 0.55 : 0) - (keys['ArrowRight'] || keys['KeyD'] ? 0.55 : 0);
    const speedFactor = Math.max(0.3, 1.0 - (car.velocity.length() / 85)); 
    car.inputs.steer = THREE.MathUtils.lerp(car.inputs.steer, targetSteer * speedFactor, 0.25);

    car.update(dt);

    if (car.mesh) {
        const camOffset = new THREE.Vector3(0, 2.2, -6.5).applyQuaternion(car.mesh.quaternion);
        camera.position.lerp(car.mesh.position.clone().add(camOffset), 0.15);
        camera.lookAt(car.mesh.position.clone().add(new THREE.Vector3(0, 0.8, 0)));
        camera.fov = 70 + (car.velocity.length() * 0.45);
        camera.updateProjectionMatrix();
    }

    renderer.render(scene, camera);
}

window.onresize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
};

animate();
