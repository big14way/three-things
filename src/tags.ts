import { createComponent, Types } from '@iwsdk/core';

/** A paper card for one thing; `thingId` points into the store. */
export const Card = createComponent('Card', {
  thingId: { type: Types.String, default: '' },
});

/** The writing slate. */
export const Slate = createComponent('Slate', {});

/** The "Today" board with three slots. */
export const Board = createComponent('Board', {});

/** The jar that done cards are dropped into. */
export const Jar = createComponent('Jar', {});
