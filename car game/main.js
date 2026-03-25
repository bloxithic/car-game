import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- 1. SCENE SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050505); // Dark aesthetic
scene.fog = new THREE.Fog(0x000000, 20, 150);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// --- 2. LIGHTING ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 1);
sunLight.position.set(10, 20, 10);
scene.add(sunLight);

// --- 3. THE WORLD ---
const grid = new THREE.GridHelper(1000, 100, 0x00ff00, 0x222222);
scene.add(grid);

// --- 4. THE CAR LOADOUT ---
const carGroup = new THREE.Group();
scene.add(carGroup);

let carModel;
const loader = new GLTFLoader();

// Load your car.glb from the models folder
loader.load('./models/car.glb', (gltf) => {
    carModel = gltf.scene;
    
    // Scale or rotate the model if it's too big/small or facing the wrong way
    // carModel.scale.set(0.5, 0.5, 0.5); 
    // carModel.rotation.y = Math.PI; // Rotate 180 if it drives backward
    
    carGroup.add(carModel);
    console.log("Car Loaded Successfully!");
}, undefined, (error) => {
    console.error("Error loading car.glb:", error);
});

// --- 5. DRIFT PHYSICS ---
let velocity = new THREE.Vector3();
let carRotation = 0;
let speed = 0;
const keys = {};

window.addEventListener('keydown', (e) => keys[e.code] = true);
window.addEventListener('keyup', (e) => keys[e.code] = false);

function update() {
    // Controls
    const accel = keys['KeyW'] ? 0.02 : (keys['KeyS'] ? -0.015 : 0);
    const isDrifting = keys['ShiftLeft'] || keys['ShiftRight'];
    
    // Steering Logic
    const turnSpeed = isDrifting ? 0.07 : 0.04;
    if (Math.abs(speed) > 0.01) {
        if (keys['KeyA']) carRotation += turnSpeed;
        if (keys['KeyD']) carRotation -= turnSpeed;
    }

    // Speed & Friction
    speed += accel;
    speed *= 0.985; // Natural deceleration

    // Drift Math: Low factor = more "slidiness"
    const driftFactor = isDrifting ? 0.88 : 0.97;
    
    const targetDir = new THREE.Vector3(
        Math.sin(carRotation) * speed,
        0,
        Math.cos(carRotation) * speed
    );

    // Slide the velocity toward the nose direction
    velocity.lerp(targetDir, 1 - driftFactor);

    // Apply movement
    carGroup.position.add(velocity);
    carGroup.rotation.y = carRotation;

    // Visual Tilt (Juice)
    if (carModel) {
        const targetTilt = keys['KeyA'] ? 0.08 : (keys['KeyD'] ? -0.08 : 0);
        carModel.rotation.z = THREE.MathUtils.lerp(carModel.rotation.z, targetTilt, 0.1);
    }

    // Smooth Camera Follow
    const camDist = 10;
    const camHeight = 4;
    const cameraTarget = new THREE.Vector3(
        carGroup.position.x - Math.sin(carRotation) * camDist,
        carGroup.position.y + camHeight,
        carGroup.position.z - Math.cos(carRotation) * camDist
    );
    camera.position.lerp(cameraTarget, 0.1);
    camera.lookAt(carGroup.position);

    // UI Update
    const speedDisplay = Math.abs(speed * 120).toFixed(0);
    document.getElementById('speedometer').innerText = `${speedDisplay} MPH ${isDrifting ? ' - DRIFTING' : ''}`;

    renderer.render(scene, camera);
    requestAnimationFrame(update);
}

// Handle resizing
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

update();