# blog-ueditor 后端 Makefile
#
# 使用方法：make <命令>
# 等同于 npm run <script>

.PHONY: dev start install build clean test lint help

# 默认命令
help:
	@echo "可用命令："
	@echo "  make install  - 安装依赖"
	@echo "  make dev      - 开发模式启动（热重载）"
	@echo "  make start    - 生产模式启动"
	@echo "  make test     - 运行测试"
	@echo "  make lint     - 代码检查"
	@echo "  make clean    - 清理临时文件"

# 安装依赖（等同于 npm install）
install:
	pip install -r requirements.txt

# 安装开发依赖
install-dev:
	pip install -r requirements.txt
	pip install pytest pytest-asyncio ruff

# 开发模式启动（等同于 npm run dev）
dev:
	uvicorn app:app --host 0.0.0.0 --port 8381 --reload

# 生产模式启动（等同于 npm start）
start:
	uvicorn app:app --host 0.0.0.0 --port 8381 --workers 4

# 运行测试（等同于 npm test）
test:
	pytest -v

# 代码检查（等同于 npm run lint）
lint:
	ruff check .
	ruff format --check .

# 代码格式化
format:
	ruff format .

# 清理临时文件（等同于 npm run clean）
clean:
	rm -rf __pycache__ .pytest_cache .ruff_cache
	rm -rf export_temp/*
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true

# 检查语法
check:
	python3 -m py_compile app.py
	@echo "语法检查通过"
