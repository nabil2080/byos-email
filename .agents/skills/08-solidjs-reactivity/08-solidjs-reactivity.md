# UI Engineering: SolidJS Reactivity Constraints

## Trigger
Load this skill when creating, modifying, or reviewing frontend components, state management, or UI logic in `.tsx` or `.ts` files within the presentation layer.

## Core Directives

1. **Never Destructure Props:** SolidJS relies on property access for reactivity. Destructuring `props` destroys reactivity. Always use `props.propertyName` or `splitProps`.
2. **Strict Control Flow:** Never use `Array.prototype.map` or conditional ternary operators for rendering arrays and large DOM trees. Always use Solid's native `<For>`, `<Index>`, and `<Show>` components.
3. **Reactive State:** Use `createSignal` for primitive UI state and `createStore` for complex nested objects. Do not mutate state objects directly; use the setter function.
4. **Effect Isolation:** Keep `createEffect` blocks small and isolated. Avoid chained effects that trigger each other (waterfalls). Do not use `createEffect` to write to DOM elements manually if a reactive attribute binding can achieve the same result.
5. **Event Delegation:** Prefer native DOM events directly on elements (e.g., `onClick`, `onInput`). Ensure event handlers properly type the event (`e: MouseEvent`, `e: KeyboardEvent`).