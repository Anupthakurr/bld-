'use strict';

const Docker = require('dockerode');
const http = require('http');

const docker = new Docker(); // Uses named pipe on Windows: //./pipe/docker_engine

const IMAGE_NAME = 'bld-chromium';
const CONTAINER_NAME = 'bld-remote-browser';
const CDP_HOST_PORT = 9222;

let activeContainerId = null;

/**
 * Build the Docker image from the local Dockerfile.
 * Streams build output to the provided callback.
 */
async function buildImage(onProgress) {
  const path = require('path');
  const dockerfilePath = path.resolve(__dirname, '../docker');

  return new Promise((resolve, reject) => {
    docker.buildImage(
      { context: dockerfilePath, src: ['Dockerfile'] },
      { t: IMAGE_NAME },
      (err, stream) => {
        if (err) return reject(err);
        docker.modem.followProgress(
          stream,
          (err, output) => {
            if (err) return reject(err);
            resolve(output);
          },
          (event) => {
            if (onProgress && event.stream) {
              onProgress(event.stream.trim());
            }
          }
        );
      }
    );
  });
}

/**
 * Check if our image already exists locally.
 */
async function imageExists() {
  try {
    const images = await docker.listImages({ filters: { reference: [IMAGE_NAME] } });
    return images.length > 0;
  } catch {
    return false;
  }
}

/**
 * Remove any existing container with our name (clean slate).
 */
async function cleanupExistingContainer() {
  try {
    const containers = await docker.listContainers({
      all: true,
      filters: { name: [CONTAINER_NAME] },
    });
    for (const info of containers) {
      const c = docker.getContainer(info.Id);
      if (info.State === 'running') await c.stop({ t: 2 }).catch(() => {});
      await c.remove({ force: true }).catch(() => {});
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Start the Chromium container and return its ID.
 */
async function startContainer(onProgress) {
  // 1. Build image if it doesn't exist
  if (!(await imageExists())) {
    if (onProgress) onProgress('Building Docker image (first run, ~1-2 min)...');
    await buildImage(onProgress);
    if (onProgress) onProgress('Image built successfully.');
  }

  // 2. Remove any stale container
  await cleanupExistingContainer();

  // 3. Create and start new container
  if (onProgress) onProgress('Creating container...');
  const container = await docker.createContainer({
    Image: IMAGE_NAME,
    name: CONTAINER_NAME,
    ExposedPorts: { '9222/tcp': {} },
    HostConfig: {
      PortBindings: {
        '9222/tcp': [{ HostIp: '127.0.0.1', HostPort: String(CDP_HOST_PORT) }],
      },
      AutoRemove: false,
    },
  });

  await container.start();
  activeContainerId = container.id;
  if (onProgress) onProgress('Container started. Waiting for Chromium to be ready...');

  // 4. Wait for CDP endpoint to be available
  await waitForCDP(CDP_HOST_PORT, 30000, onProgress);
  if (onProgress) onProgress('Chromium is ready!');

  return container.id;
}

/**
 * Stop and remove the active container.
 */
async function stopContainer() {
  if (!activeContainerId) return;
  try {
    const container = docker.getContainer(activeContainerId);
    await container.stop({ t: 3 }).catch(() => {});
    await container.remove({ force: true }).catch(() => {});
  } catch (err) {
    console.error('Error stopping container:', err.message);
  }
  activeContainerId = null;
}

/**
 * Poll the CDP HTTP endpoint until it responds or timeout.
 */
function waitForCDP(port, timeoutMs = 30000, onProgress) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let dots = 0;

    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          return reject(new Error('Timeout waiting for Chromium CDP'));
        }
        dots++;
        if (onProgress && dots % 5 === 0) onProgress('Still waiting for Chromium...');
        setTimeout(check, 500);
      });
      req.setTimeout(1000, () => {
        req.destroy();
        setTimeout(check, 500);
      });
    };
    check();
  });
}

module.exports = { startContainer, stopContainer, imageExists, activeContainerId: () => activeContainerId };
