/**
 * HTML 清洗工具模块
 *
 * 提供 Safe 和 Aggressive 两种模式的 HTML 清洗功能。
 * - Safe 模式：移除危险内容，保留基本排版样式
 * - Aggressive 模式：移除所有样式，只保留语义结构
 */

import type { CleanMode } from '../types/api';

/** 清洗结果 */
export interface CleanResult {
  /** 清洗后的 HTML */
  html: string;
  /** 提取的图片 URL 列表 */
  imageUrls: string[];
  /** 清洗统计 */
  stats: {
    /** 移除的标签数量 */
    removedTags: number;
    /** 移除的属性数量 */
    removedAttributes: number;
    /** 发现的图片数量 */
    imagesFound: number;
  };
}

/** 清洗选项 */
export interface CleanOptions {
  /** 是否保留 class 属性（Safe 模式生效） */
  keepClasses?: boolean;
  /** 是否保留 id 属性（Safe 模式生效） */
  keepIds?: boolean;
  /** 是否保留 style 属性（Safe 模式生效） */
  keepInlineStyles?: boolean;
  /** 额外允许的标签（逗号分隔输入后解析） */
  allowedTags?: string[];
  /** 额外允许的属性（逗号分隔输入后解析） */
  allowedAttributes?: string[];
}

// 危险标签列表（两种模式都会移除）
const DANGEROUS_TAGS = [
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'link',
  'meta',
  'base',
  'noscript',
];

// Safe 模式下保留的内联样式属性（保留大部分排版相关样式）
const SAFE_STYLE_PROPERTIES = [
  // 颜色和背景
  'color',
  'background-color',
  'background-image',
  'background-position',
  'background-repeat',
  'background-size',
  'background-attachment',
  'background-origin',
  'background-clip',
  'background',
  'opacity',
  // 字体相关
  'font-size',
  'font-weight',
  'font-style',
  'font-family',
  'font',
  // 文本相关
  'text-align',
  'text-decoration',
  'text-indent',
  'text-transform',
  'text-shadow',
  'text-overflow',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'word-break',
  'word-wrap',
  'white-space',
  // 盒模型
  'box-sizing',
  'margin',
  'margin-top',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'padding',
  'padding-top',
  'padding-bottom',
  'padding-left',
  'padding-right',
  // 边框
  'border',
  'border-top',
  'border-bottom',
  'border-left',
  'border-right',
  'border-width',
  'border-style',
  'border-color',
  'border-radius',
  'border-collapse',
  'border-spacing',
  // 阴影
  'box-shadow',
  // 尺寸
  'width',
  'min-width',
  'max-width',
  'height',
  'min-height',
  'max-height',
  // 布局
  'display',
  'float',
  'clear',
  'position',
  'top',
  'bottom',
  'left',
  'right',
  'z-index',
  'overflow',
  'overflow-x',
  'overflow-y',
  'vertical-align',
  // Flex 布局
  'flex',
  'flex-direction',
  'flex-wrap',
  'flex-flow',
  'justify-content',
  'align-items',
  'align-content',
  'align-self',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'order',
  'gap',
  // Grid 布局
  'grid',
  'grid-template',
  'grid-template-columns',
  'grid-template-rows',
  'grid-gap',
  'grid-column',
  'grid-row',
  // 变换
  'transform',
  'transform-origin',
  // 过渡和动画
  'transition',
  'animation',
  // 其他
  'visibility',
  'cursor',
  'outline',
  'list-style',
  'list-style-type',
  'table-layout',
  'clip',
  'clip-path',
  'filter',
  'backdrop-filter',
  'object-fit',
  'object-position',
];

// Aggressive 模式下保留的语义标签
const SEMANTIC_TAGS = [
  'p',
  'div',
  'span',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'a',
  'img',
  'br',
  'hr',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'strike',
  'del',
  'ins',
  'blockquote',
  'pre',
  'code',
  'sup',
  'sub',
  'section',
  'article',
  'header',
  'footer',
  'nav',
  'aside',
  'main',
  'figure',
  'figcaption',
  'caption',
  'video',
  'audio',
  'source',
];

// 保留的属性白名单
const SAFE_ATTRIBUTES: Record<string, string[]> = {
  '*': ['id', 'class', 'title', 'lang', 'dir'],
  a: ['href', 'target', 'rel'],
  img: ['src', 'alt', 'width', 'height', 'loading'],
  video: ['src', 'controls', 'autoplay', 'muted', 'loop', 'poster', 'width', 'height'],
  audio: ['src', 'controls', 'autoplay', 'muted', 'loop'],
  source: ['src', 'type'],
  table: ['border', 'cellpadding', 'cellspacing'],
  td: ['colspan', 'rowspan', 'align', 'valign'],
  th: ['colspan', 'rowspan', 'align', 'valign', 'scope'],
  col: ['span', 'width'],
  colgroup: ['span'],
};

/**
 * 从 HTML 字符串中提取所有图片 URL
 *
 * @param html - HTML 字符串
 * @returns 去重后的图片 URL 数组
 */
export function extractImageUrls(html: string): string[] {
  const urls = new Set<string>();

  /**
   * 添加 URL 到集合（统一处理）
   * @param url - 图片 URL
   */
  const addUrl = (url: string | undefined | null) => {
    if (!url) return;

    // 解码 HTML 实体
    let decodedUrl = url
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');

    // 去除开头和结尾的引号（处理 url(&quot;...&quot;) 的情况）
    decodedUrl = decodedUrl.replace(/^["']|["']$/g, '').trim();

    // 排除 data: 开头的 base64 图片
    if (decodedUrl && !decodedUrl.startsWith('data:')) {
      urls.add(decodedUrl);
    }
  };

  let match;

  // 提取 <img> 标签的 src 属性
  const imgSrcRegex = /<img[^>]+src=["']([^"']+)["']/gi;
  while ((match = imgSrcRegex.exec(html)) !== null) {
    addUrl(match[1]);
  }

  // 提取 data-src 属性（懒加载图片）
  const dataSrcRegex = /<img[^>]+data-src=["']([^"']+)["']/gi;
  while ((match = dataSrcRegex.exec(html)) !== null) {
    addUrl(match[1]);
  }

  // 提取 data-original 属性（另一种懒加载方式）
  const dataOriginalRegex = /<img[^>]+data-original=["']([^"']+)["']/gi;
  while ((match = dataOriginalRegex.exec(html)) !== null) {
    addUrl(match[1]);
  }

  // 提取任何标签上的 data-background-image 属性
  const dataBgRegex = /data-background-image=["']([^"']+)["']/gi;
  while ((match = dataBgRegex.exec(html)) !== null) {
    addUrl(match[1]);
  }

  // 提取 background-image: url(...) 中的 URL
  const bgImageRegex = /background-image\s*:\s*url\(["']?([^"')]+)["']?\)/gi;
  while ((match = bgImageRegex.exec(html)) !== null) {
    addUrl(match[1]);
  }

  // 提取 background: ... url(...) 中的 URL
  const bgRegex = /background\s*:[^;]*url\(["']?([^"')]+)["']?\)/gi;
  while ((match = bgRegex.exec(html)) !== null) {
    addUrl(match[1]);
  }

  // 提取 list-style-image: url(...) 中的 URL
  const listStyleRegex = /list-style-image\s*:\s*url\(["']?([^"')]+)["']?\)/gi;
  while ((match = listStyleRegex.exec(html)) !== null) {
    addUrl(match[1]);
  }

  // 提取 content: url(...) 中的 URL（用于 ::before/::after 伪元素）
  const contentRegex = /content\s*:\s*url\(["']?([^"')]+)["']?\)/gi;
  while ((match = contentRegex.exec(html)) !== null) {
    addUrl(match[1]);
  }

  return Array.from(urls);
}

/**
 * 过滤内联样式，只保留安全的样式属性
 *
 * @param styleValue - style 属性值
 * @returns 过滤后的样式字符串
 */
function filterStyle(styleValue: string): string {
  if (!styleValue) return '';

  const styles = styleValue.split(';').filter((s) => s.trim());
  const filteredStyles: string[] = [];

  for (const style of styles) {
    const [property] = style.split(':').map((s) => s.trim().toLowerCase());
    if (property && SAFE_STYLE_PROPERTIES.some((p) => property.startsWith(p))) {
      filteredStyles.push(style.trim());
    }
  }

  return filteredStyles.join('; ');
}

/**
 * 检查属性是否应该保留
 *
 * @param tagName - 标签名
 * @param attrName - 属性名
 * @param mode - 清洗模式
 * @returns 是否保留该属性
 */
function shouldKeepAttribute(
  tagName: string,
  attrName: string,
  mode: CleanMode,
  options: Required<CleanOptions>
): boolean {
  const lowerAttr = attrName.toLowerCase();
  const lowerTag = tagName.toLowerCase();

  // 两种模式都移除事件处理器
  if (lowerAttr.startsWith('on')) {
    return false;
  }

  // Safe 模式下根据配置决定是否保留 class/id/style
  if (mode === 'safe') {
    if (lowerAttr === 'class' && !options.keepClasses) {
      return false;
    }
    if (lowerAttr === 'id' && !options.keepIds) {
      return false;
    }
    if (lowerAttr === 'style' && !options.keepInlineStyles) {
      return false;
    }
  }

  // 额外允许的属性（两种模式通用）
  if (options.allowedAttributes.includes(lowerAttr)) {
    return true;
  }

  // 两种模式都移除 javascript: 链接（在值检查中处理）
  // 检查通用白名单
  const globalAttrs = SAFE_ATTRIBUTES['*'] || [];
  const tagAttrs = SAFE_ATTRIBUTES[lowerTag] || [];

  // Aggressive 模式下只保留核心属性
  if (mode === 'aggressive') {
    // 只保留 href、src、alt 等核心属性
    const coreAttrs = ['href', 'src', 'alt', 'width', 'height', 'colspan', 'rowspan'];
    return coreAttrs.includes(lowerAttr);
  }

  // Safe 模式下保留更多属性
  return globalAttrs.includes(lowerAttr) || tagAttrs.includes(lowerAttr) || lowerAttr === 'style';
}

/**
 * 清洗 HTML 内容
 *
 * @param html - 原始 HTML 字符串
 * @param mode - 清洗模式（'safe' 或 'aggressive'）
 * @returns 清洗结果
 */
export function cleanHtml(
  html: string,
  mode: CleanMode = 'safe',
  options: CleanOptions = {}
): CleanResult {
  // 使用默认配置兜底，避免多处判空
  const resolvedOptions: Required<CleanOptions> = {
    keepClasses: options.keepClasses ?? true,
    keepIds: options.keepIds ?? true,
    keepInlineStyles: options.keepInlineStyles ?? true,
    allowedTags: (options.allowedTags ?? []).map((tag) => tag.toLowerCase()),
    allowedAttributes: (options.allowedAttributes ?? []).map((attr) => attr.toLowerCase()),
  };

  const stats = {
    removedTags: 0,
    removedAttributes: 0,
    imagesFound: 0,
  };

  // 先提取图片 URL
  const imageUrls = extractImageUrls(html);
  stats.imagesFound = imageUrls.length;

  // 创建 DOM 解析器
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // 递归处理函数
  function processNode(node: Node): void {
    // 处理元素节点
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      const tagName = element.tagName.toLowerCase();

      // 检查是否是危险标签
      if (DANGEROUS_TAGS.includes(tagName)) {
        stats.removedTags++;
        element.remove();
        return;
      }

      // Aggressive 模式下，移除非语义标签（保留内容）
      if (
        mode === 'aggressive' &&
        !SEMANTIC_TAGS.includes(tagName) &&
        !resolvedOptions.allowedTags.includes(tagName)
      ) {
        // 用内容替换标签
        const fragment = document.createDocumentFragment();
        while (element.firstChild) {
          fragment.appendChild(element.firstChild);
        }
        element.replaceWith(fragment);
        stats.removedTags++;
        return;
      }

      // 处理属性
      const attributesToRemove: string[] = [];
      for (const attr of Array.from(element.attributes)) {
        // 检查属性值是否包含危险内容
        const attrValue = attr.value.toLowerCase();
        if (
          attrValue.includes('javascript:') ||
          attrValue.includes('vbscript:') ||
          attrValue.includes('data:text/html')
        ) {
          attributesToRemove.push(attr.name);
          continue;
        }

        // 检查是否应该保留该属性
        if (!shouldKeepAttribute(tagName, attr.name, mode, resolvedOptions)) {
          attributesToRemove.push(attr.name);
        }
      }

      // 移除不需要的属性
      for (const attrName of attributesToRemove) {
        element.removeAttribute(attrName);
        stats.removedAttributes++;
      }

      // Safe 模式下过滤或移除 style 属性
      if (mode === 'safe' && element.hasAttribute('style')) {
        if (!resolvedOptions.keepInlineStyles) {
          element.removeAttribute('style');
          stats.removedAttributes++;
        } else {
          const filteredStyle = filterStyle(element.getAttribute('style') || '');
          if (filteredStyle) {
            element.setAttribute('style', filteredStyle);
          } else {
            element.removeAttribute('style');
            stats.removedAttributes++;
          }
        }
      }

      // Safe 模式下按配置移除 class/id
      if (mode === 'safe') {
        if (!resolvedOptions.keepClasses && element.hasAttribute('class')) {
          element.removeAttribute('class');
          stats.removedAttributes++;
        }
        if (!resolvedOptions.keepIds && element.hasAttribute('id')) {
          element.removeAttribute('id');
          stats.removedAttributes++;
        }
      }

      // Aggressive 模式下移除 style 和 class
      if (mode === 'aggressive') {
        if (element.hasAttribute('style')) {
          element.removeAttribute('style');
          stats.removedAttributes++;
        }
        if (element.hasAttribute('class')) {
          element.removeAttribute('class');
          stats.removedAttributes++;
        }
      }

      // 递归处理子节点
      const children = Array.from(node.childNodes);
      for (const child of children) {
        processNode(child);
      }
    }
  }

  // 处理 body 内的所有节点
  const children = Array.from(doc.body.childNodes);
  for (const child of children) {
    processNode(child);
  }

  // 获取清洗后的 HTML
  let cleanedHtml = doc.body.innerHTML;

  // 清理多余的空白和空标签
  cleanedHtml = cleanedHtml
    .replace(/(<[^>]+>)\s+(<)/g, '$1$2') // 移除标签间的空白
    .replace(/<(\w+)(\s[^>]*)?>\s*<\/\1>/g, '') // 移除空标签
    .replace(/\n\s*\n/g, '\n') // 合并多个空行
    .trim();

  return {
    html: cleanedHtml,
    imageUrls,
    stats,
  };
}

/**
 * 获取 HTML 的纯文本内容
 *
 * @param html - HTML 字符串
 * @returns 纯文本内容
 */
export function getPlainText(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
}

/**
 * 统计 HTML 中的字符数
 *
 * @param html - HTML 字符串
 * @returns 字符数（不包含空白）
 */
export function countCharacters(html: string): number {
  const text = getPlainText(html);
  return text.replace(/\s/g, '').length;
}
