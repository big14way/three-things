import { UIKitMLAsset, VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { ThreeThingsSystem } from './app.js';

World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions).then((world) => {
  world.registerSystem(ThreeThingsSystem);
  if (import.meta.env.DEV) {
    void import('./dev-driver.js').then((m) => m.installDevDriver(world, world.getSystem(ThreeThingsSystem)));
  }
  // The welcome card only makes sense on a flat screen.
  const welcome = world.getSceneObject<UIKitMLAsset>('welcome-panel');
  welcome?.getElementById('enter')?.addEventListener('click', () => world.launchXR());
  world.visibilityState.subscribe((s) => {
    if (welcome) welcome.visible = s === VisibilityState.NonImmersive;
  });
});
