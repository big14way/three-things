import { SessionMode, UIKitMLAsset, VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { ThreeThingsSystem } from './app.js';

const loading = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');

/** Can this browser start a mixed reality (or at least a VR) session? */
async function xrSupport(): Promise<'ar' | 'vr' | 'none'> {
  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  if (!xr) return 'none';
  try {
    if (await xr.isSessionSupported('immersive-ar')) return 'ar';
    if (await xr.isSessionSupported('immersive-vr')) return 'vr';
  } catch {
    // treat errors as unsupported
  }
  return 'none';
}

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions)
  .then(async (world) => {
    world.registerSystem(ThreeThingsSystem);
    if (import.meta.env.DEV) {
      void import('./dev-driver.js').then((m) => m.installDevDriver(world, world.getSystem(ThreeThingsSystem)));
    }
    const welcome = world.getSceneObject<UIKitMLAsset>('welcome-panel');
    const support = await xrSupport();
    const enter = welcome?.getElementById('enter');
    if (support === 'none') {
      // A computer or phone: say where it runs, and offer the browser emulator.
      enter?.setProperties({ display: 'none' });
      welcome?.getElementById('no-xr')?.setProperties({ display: 'flex' });
      welcome?.getElementById('emulator')?.addEventListener('click', () => {
        location.href = `${import.meta.env.BASE_URL}emulator/`;
      });
    } else {
      enter?.addEventListener('click', () =>
        world.launchXR(support === 'vr' ? { sessionMode: SessionMode.ImmersiveVR } : undefined),
      );
    }
    world.visibilityState.subscribe((s) => {
      if (welcome) welcome.visible = s === VisibilityState.NonImmersive;
    });
    loading?.classList.add('done');
    setTimeout(() => loading?.remove(), 600);
  })
  .catch((err) => {
    console.error(err);
    if (loadingText) loadingText.textContent = 'Something went wrong while loading. Please reload the page.';
  });
