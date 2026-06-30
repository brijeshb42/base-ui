import { defineComponent, h, ref } from 'vue';

// Hello-world Vue demo using a render function (no SFC compilation needed).
export const HelloWorld = defineComponent({
  name: 'HelloWorld',
  setup() {
    const count = ref(0);
    return () =>
      h('div', { style: { display: 'grid', gap: '8px', fontFamily: 'sans-serif' } }, [
        h('p', `Hello from Vue ${count.value === 0 ? '👋' : '🎉'}`),
        h(
          'button',
          {
            type: 'button',
            onClick: () => {
              count.value += 1;
              return count.value;
            },
          },
          `Clicked ${count.value} times`,
        ),
      ]);
  },
});
