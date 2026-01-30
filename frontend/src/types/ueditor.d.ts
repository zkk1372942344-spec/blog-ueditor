/**
 * 全局类型声明
 *
 * 用于 UEditor 和其他第三方库的类型声明
 */

// UEditor 编辑器实例接口
interface UEditorInstance {
  /** 获取编辑器 HTML 内容 */
  getContent: () => string;
  /** 获取编辑器纯文本内容 */
  getContentTxt: () => string;
  /** 设置编辑器内容 */
  setContent: (html: string, isAppend?: boolean) => void;
  /** 判断编辑器是否就绪 */
  isReady: () => boolean;
  /** 判断编辑器是否有内容 */
  hasContents: () => boolean;
  /** 聚焦编辑器 */
  focus: () => void;
  /** 销毁编辑器实例 */
  destroy: () => void;
  /** 添加事件监听器 */
  addListener: (eventName: string, callback: () => void) => void;
  /** 设置编辑器高度 */
  setHeight: (height: number) => void;
}

// UEditor 配置选项接口
interface UEditorOptions {
  /** 初始编辑区域高度 */
  initialFrameHeight?: number;
  /** 初始编辑区域宽度 */
  initialFrameWidth?: string | number;
  /** 是否启用工具栏浮动 */
  autoFloatEnabled?: boolean;
  /** 工具栏配置 */
  toolbars?: string[][];
  /** 其他配置项 */
  [key: string]: unknown;
}

// UEditor 全局对象接口
interface UEditorGlobal {
  /** 获取或创建编辑器实例 */
  getEditor: (containerId: string, options?: UEditorOptions) => UEditorInstance;
  /** 删除编辑器实例 */
  delEditor: (containerId: string) => void;
  /** 获取所有编辑器实例 */
  getEditors: () => Record<string, UEditorInstance>;
}

// 扩展 Window 接口
declare global {
  interface Window {
    UE: UEditorGlobal;
    UEDITOR_CONFIG: Record<string, unknown>;
    UEDITOR_HOME_URL: string;
  }
}

export type { UEditorInstance, UEditorOptions, UEditorGlobal };
