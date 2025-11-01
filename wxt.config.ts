import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    permissions: [
      'storage',
      'activeTab',
      'tabs'
    ],
    host_permissions: [
      '<all_urls>'
    ],
    name: 'H4ckoverflow',
    description: 'A focused, minimalist browser extension designed to boost productivity and perform security reconnaissance.',
  },
});
