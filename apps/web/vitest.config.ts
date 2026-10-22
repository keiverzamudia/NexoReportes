import { defineConfig } from 'vitest/config';

// Pruebas del motor puro del simulador (sin DOM ni red).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.spec.ts'],
  },
});
