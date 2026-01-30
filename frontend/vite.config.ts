/**
 * Vite 配置文件
 *
 * 配置开发服务器代理、构建选项等
 */

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // 开发服务器配置
  server: {
    port: 4381,
    // API 代理配置 - 将 /api 请求转发到后端服务
    proxy: {
      '/api': {
        target: 'http://localhost:8381',
        changeOrigin: true,
        secure: false,
      },
    },
  },

  // 构建配置
  build: {
    outDir: 'dist',
    sourcemap: false,
    // 资源文件阈值（小于此值将内联为 base64）
    assetsInlineLimit: 4096,
    // 拆分代码块
    rollupOptions: {
      output: {
        manualChunks: {
          // 将 React 相关库单独打包
          react: ['react', 'react-dom'],
        },
      },
    },
  },

  // 解析配置
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
