// 入口：环境判断 + 选择 adapter，构造并导出 fetch
import { createFetch } from './fetch.js';
import { browserAdapter } from './adapter-browser.js';
import { nodeAdapter } from './adapter-node.js';

// 浏览器存在 window / document；Node 不存在。SSR 环境需要 polyfill 时也能正确走 nodeAdapter
const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';

const adapter = isBrowser ? browserAdapter : nodeAdapter;

const fetch = createFetch(adapter);

export { fetch };
export default fetch;