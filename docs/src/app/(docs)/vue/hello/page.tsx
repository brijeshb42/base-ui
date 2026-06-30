import * as React from 'react';
import { HelloWorldDemo } from 'docs/src/components/VueIsland/HelloWorldDemo';

// Spike: prove a Vue island renders inside the Next.js docs app.
export default function VueHelloPage() {
  return (
    <main style={{ padding: 32, display: 'grid', gap: 16 }}>
      <h1>Vue island spike</h1>
      <p>Below is a Vue 3 component mounted inside this React/Next page:</p>
      <div style={{ padding: 16, border: '1px solid currentColor', borderRadius: 8 }}>
        <HelloWorldDemo />
      </div>
    </main>
  );
}
