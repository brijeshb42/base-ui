import { NavigationMenu } from '@base-ui/react/navigation-menu';
import * as React from 'react';

const cache = new Map<string, { done: boolean; promise: Promise<void> }>();
function suspendOnce(key: string): void {
  let entry = cache.get(key);
  if (!entry) {
    const created = { done: false, promise: Promise.resolve() };
    created.promise = new Promise<void>((resolve) => {
      setTimeout(() => {
        created.done = true;
        resolve();
      }, 150);
    });
    cache.set(key, created);
    entry = created;
  }
  if (!entry.done) throw entry.promise;
}

function SuspendingContent({ id }: { id: string }) {
  suspendOnce(id);
  return <span>content {id}</span>;
}

const ITEMS = ['a', 'b', 'c', 'd', 'e'];

export default function App() {
  return (
    <React.Suspense fallback={<div>loading…</div>}>
      <NavigationMenu.Root>
        <NavigationMenu.List style={{ display: 'flex', gap: '1rem' }}>
          {ITEMS.map((id) => (
            <NavigationMenu.Item key={id}>
              <NavigationMenu.Trigger style={{ padding: '0.5rem 1rem' }}>
                {id}
              </NavigationMenu.Trigger>
              <NavigationMenu.Content>
                <SuspendingContent id={id} />
              </NavigationMenu.Content>
            </NavigationMenu.Item>
          ))}
        </NavigationMenu.List>
        <NavigationMenu.Portal>
          <NavigationMenu.Positioner>
            <NavigationMenu.Popup
              style={{
                padding: '1rem',
                border: '1px solid #ccc',
                backgroundColor: '#fff',
              }}
            >
              <NavigationMenu.Viewport />
            </NavigationMenu.Popup>
          </NavigationMenu.Positioner>
        </NavigationMenu.Portal>
      </NavigationMenu.Root>
    </React.Suspense>
  );
}
