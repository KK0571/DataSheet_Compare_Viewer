// PDF.js 库初始化
const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/pdf.worker.min.js';

// 全局状态变量
let isSyncing = false;
let isDraggingScrollbar = false;
let scrollbarDragSource = null;
let pdfDocuments = { left: null, right: null };
let searchResults = { left: [], right: [] };
let currentScale = 1.2;

// DOM 元素引用
const leftPanel = document.getElementById('viewer-left');
const rightPanel = document.getElementById('viewer-right');

// 初始化
function init() {
    // 初始化拖拽控制
    setupDropZone('left');
    setupDropZone('right');

    // 监听鼠标按下事件，检测是否开始拖动滚动条
    leftPanel.addEventListener('mousedown', (e) => {
        if (isOverScrollbar(leftPanel, e)) {
            isDraggingScrollbar = true;
            scrollbarDragSource = 'left';
        }
    });
    rightPanel.addEventListener('mousedown', (e) => {
        if (isOverScrollbar(rightPanel, e)) {
            isDraggingScrollbar = true;
            scrollbarDragSource = 'right';
        }
    });

    // 鼠标释放时重置状态
    document.addEventListener('mouseup', () => {
        isDraggingScrollbar = false;
        scrollbarDragSource = null;
    });

    // 滚轮滚动时两边同步
    leftPanel.addEventListener('wheel', (e) => handleWheel(e, leftPanel, rightPanel), { passive: false });
    rightPanel.addEventListener('wheel', (e) => handleWheel(e, rightPanel, leftPanel), { passive: false });

    // scroll 事件：只有拖动滚动条时才触发同步
    leftPanel.addEventListener('scroll', () => {
        if (isDraggingScrollbar && scrollbarDragSource === 'left') {
            return;
        }
    });
    rightPanel.addEventListener('scroll', () => {
        if (isDraggingScrollbar && scrollbarDragSource === 'right') {
            return;
        }
    });

    // 监听回车键跳转页面
    ['left', 'right'].forEach(side => {
        const nav = document.getElementById(`page-nav-${side}`);
        if (nav) {
            const input = nav.querySelector('.page-input');
            if (input) {
                input.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        jumpToInputPage(side);
                    }
                });
            }
        }
    });

    // 回车搜索
    document.getElementById('search-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            performSearch();
        }
    });

    // 点击外部关闭菜单
    document.addEventListener('click', (e) => {
        const dropdown = document.querySelector('.search-filter-dropdown');
        if (!dropdown.contains(e.target)) {
            document.getElementById('search-filter-menu').classList.remove('show');
        }
    });

    // 页面载入时默认收起侧边栏
    document.addEventListener('DOMContentLoaded', () => {
        collapseSidebar('left');
        collapseSidebar('right');
    });
    
    // 初始化导航按钮位置
    updatePageNavPosition();
    
    // 窗口大小改变时更新导航按钮位置
    window.addEventListener('resize', updatePageNavPosition);
    
    // 监听侧边栏收展动画完成后更新位置
    const sidebars = document.querySelectorAll('.sidebar');
    sidebars.forEach(sidebar => {
        sidebar.addEventListener('transitionend', updatePageNavPosition);
    });
}

// 更新页面导航按钮位置
function updatePageNavPosition() {
    const leftNav = document.getElementById('page-nav-left');
    const rightNav = document.getElementById('page-nav-right');
    const leftPanel = document.getElementById('viewer-left');
    const rightPanel = document.getElementById('viewer-right');
    
    if (leftNav && leftPanel) {
        const leftRect = leftPanel.getBoundingClientRect();
        leftNav.style.left = `${leftRect.left + leftRect.width / 2}px`;
    }
    
    if (rightNav && rightPanel) {
        const rightRect = rightPanel.getBoundingClientRect();
        rightNav.style.left = `${rightRect.left + rightRect.width / 2}px`;
    }
}

// 检测是否是拖动滚动条（通过检查鼠标位置是否在滚动条区域）
function isOverScrollbar(element, event) {
    const rect = element.getBoundingClientRect();
    const scrollbarWidth = element.offsetWidth - element.clientWidth;
    if (element.id === 'viewer-left') {
        return event.clientX > rect.right - scrollbarWidth - 5;
    }
    return event.clientX < rect.left + scrollbarWidth + 5;
}

// 处理滚轮事件（滚动或缩放）
function handleWheel(event, source, target) {
    if (event.ctrlKey) {
        event.preventDefault();
        handleZoomSync(event);
        return;
    }
    syncWheelScroll(event, source, target);
}

// 缩放功能（两侧同步）
function handleZoomSync(event) {
    const delta = event.deltaY > 0 ? -0.1 : 0.1;
    const newScale = Math.max(0.5, Math.min(3.0, currentScale + delta));
    
    if (newScale !== currentScale) {
        currentScale = newScale;
        zoomPDF('left', newScale);
        zoomPDF('right', newScale);
    }
}

// 快速缩放 - 使用 CSS transform 缩放已渲染的内容
function zoomPDF(side, scale) {
    const container = document.getElementById(`content-${side}`);
    if (!container) return;
    
    container.style.transformOrigin = 'top center';
    container.style.transform = `scale(${scale / 1.2})`;
    
    const firstWrapper = container.querySelector('.canvas-wrapper');
    if (firstWrapper) {
        const scaledWidth = parseInt(firstWrapper.style.width) * (scale / 1.2);
        container.style.width = scaledWidth + 'px';
    }
    
    updateZoomStatus();
}

// 更新状态栏缩放信息
function updateZoomStatus() {
    const scalePercent = Math.round(currentScale * 100);
    const status = document.getElementById('status');
    const originalText = status.innerText.split(' | ')[0];
    if (originalText && originalText !== '等待文件...') {
        status.innerText = `${originalText} | 缩放: ${scalePercent}%`;
    }
}

// 同步滚轮滚动
function syncWheelScroll(event, source, target) {
    event.preventDefault();

    if (event.shiftKey) {
        source.scrollTop += event.deltaY;
        return;
    }

    if (isSyncing) return;
    isSyncing = true;

    const delta = event.deltaY;
    const newScrollTop = source.scrollTop + delta;

    source.scrollTop = newScrollTop;
    target.scrollTop = newScrollTop;

    requestAnimationFrame(() => {
        isSyncing = false;
    });
}

// 设置拖放区域
function setupDropZone(side) {
    const zone = document.getElementById(`drop-${side}`);
    const panel = document.getElementById(`viewer-${side}`);
    
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.style.borderColor = '#007bff'; });
    zone.addEventListener('dragleave', () => { zone.style.borderColor = '#999'; });
    zone.addEventListener('drop', (e) => handleDrop(e, side));
    
    panel.addEventListener('dragover', (e) => {
        if (pdfDocuments[side]) {
            e.preventDefault();
            zone.classList.remove('hidden');
            zone.style.borderColor = '#007bff';
            zone.style.background = 'rgba(0, 123, 255, 0.2)';
            zone.textContent = side === 'left' ? '拖入新文件替换芯片 A' : '拖入新文件替换芯片 B';
        }
    });
    
    panel.addEventListener('dragleave', (e) => {
        if (!panel.contains(e.relatedTarget) && pdfDocuments[side]) {
            zone.classList.add('hidden');
            zone.style.borderColor = '#999';
            zone.style.background = 'rgba(255,255,255,0.8)';
            zone.textContent = side === 'left' ? '拖入芯片 A 规格书' : '拖入芯片 B 规格书';
        }
    });
    
    panel.addEventListener('drop', (e) => {
        if (pdfDocuments[side]) {
            handleDrop(e, side);
            zone.style.background = 'rgba(255,255,255,0.8)';
            zone.textContent = side === 'left' ? '拖入芯片 A 规格书' : '拖入芯片 B 规格书';
        }
    });
}

// 处理文件拖放
function handleDrop(e, side) {
    e.preventDefault();
    const zone = document.getElementById(`drop-${side}`);
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
        zone.classList.add('hidden');
        zone.style.borderColor = '#999';
        renderPDF(file, side);
    }
}

// 渲染 PDF
async function renderPDF(file, side) {
    const url = URL.createObjectURL(file);
    const loadingTask = pdfjsLib.getDocument(url);
    const pdf = await loadingTask.promise;
    pdfDocuments[side] = pdf;
    const container = document.getElementById(`content-${side}`);
    
    const tempContainer = document.createElement('div');
    tempContainer.style.visibility = 'hidden';
    
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.2 });

        const wrapper = document.createElement('div');
        wrapper.className = 'canvas-wrapper';
        wrapper.style.width = viewport.width + 'px';
        wrapper.style.height = viewport.height + 'px';
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        wrapper.appendChild(canvas);
        tempContainer.appendChild(wrapper);

        await page.render({ canvasContext: context, viewport: viewport }).promise;

        const textContent = await page.getTextContent();
        const textLayerDiv = document.createElement('div');
        textLayerDiv.className = 'text-layer';
        textLayerDiv.style.width = viewport.width + 'px';
        textLayerDiv.style.height = viewport.height + 'px';
        wrapper.appendChild(textLayerDiv);

        textContent.items.forEach(item => {
            const span = document.createElement('span');
            span.textContent = item.str;
            const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
            const fontHeight = Math.hypot(tx[0], tx[1]);
            const fontWidth = Math.hypot(tx[2], tx[3]);
            span.style.fontSize = fontHeight + 'px';
            span.style.transform = `scaleX(${fontWidth / fontHeight})`;
            span.style.left = tx[4] + 'px';
            span.style.top = tx[5] - fontHeight + 'px';
            textLayerDiv.appendChild(span);
        });
    }
    
    container.innerHTML = '';
    while (tempContainer.firstChild) {
        container.appendChild(tempContainer.firstChild);
    }
    tempContainer.remove();
    
    document.getElementById('status').innerText = `文件加载完毕: ${file.name}`;
    
    await loadBookmarks(pdf, side);
    updatePageNav(side, pdf.numPages);
    applyZoomAndCenter(side, currentScale);
}

// 应用缩放并居中显示
function applyZoomAndCenter(side, scale) {
    const container = document.getElementById(`content-${side}`);
    if (!container) return;
    
    container.style.transformOrigin = 'top center';
    container.style.transform = `scale(${scale / 1.2})`;
    
    const firstWrapper = container.querySelector('.canvas-wrapper');
    if (firstWrapper) {
        const scaledWidth = parseInt(firstWrapper.style.width) * (scale / 1.2);
        container.style.width = scaledWidth + 'px';
    }
}

// 更新页面导航
function updatePageNav(side, totalPages) {
    const nav = document.getElementById(`page-nav-${side}`);
    if (!nav) return;
    
    const totalSpan = nav.querySelector('.page-total');
    const input = nav.querySelector('.page-input');
    
    if (totalSpan) totalSpan.textContent = totalPages;
    if (input) {
        input.max = totalPages;
        input.value = '';
    }
    nav.classList.add('visible');
}

// 跳转到输入的页面
function jumpToInputPage(side) {
    const nav = document.getElementById(`page-nav-${side}`);
    if (!nav) return;
    
    const input = nav.querySelector('.page-input');
    const pageNum = parseInt(input.value);
    const totalPages = parseInt(nav.querySelector('.page-total').textContent);
    
    if (pageNum >= 1 && pageNum <= totalPages) {
        jumpToPage(side, pageNum);
    } else {
        alert(`请输入有效的页码 (1-${totalPages})`);
    }
}

// 加载 PDF 书签
async function loadBookmarks(pdf, side) {
    const bookmarkContainer = document.getElementById(`tab-bookmark-${side}`);
    
    try {
        const outline = await pdf.getOutline();
        
        if (!outline || outline.length === 0) {
            bookmarkContainer.innerHTML = '<div class="no-bookmarks">此 PDF 没有书签</div>';
            return;
        }
        
        const bookmarkList = document.createElement('div');
        bookmarkList.className = 'bookmark-list';
        
        async function processBookmarkItems(items, level = 0) {
            for (const item of items) {
                const bookmarkItem = document.createElement('div');
                bookmarkItem.className = `bookmark-item bookmark-level-${Math.min(level, 3)}`;
                
                let pageNumber = null;
                if (item.dest) {
                    try {
                        let destRef = item.dest;
                        if (typeof item.dest === 'string') {
                            destRef = await pdf.getDestination(item.dest);
                        }
                        if (destRef && Array.isArray(destRef) && destRef.length > 0) {
                            const ref = destRef[0];
                            const pageIndex = await pdf.getPageIndex(ref);
                            pageNumber = pageIndex + 1;
                        }
                    } catch (e) {
                        console.warn('无法获取书签页码:', item.title, e);
                    }
                }
                
                bookmarkItem.innerHTML = `
                    <span class="bookmark-icon">📌</span>
                    <span class="bookmark-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
                    ${pageNumber ? `<span class="bookmark-page">第${pageNumber}页</span>` : ''}
                `;
                
                if (pageNumber) {
                    const targetPage = pageNumber;
                    const targetSide = side;
                    bookmarkItem.addEventListener('click', function(e) {
                        e.stopPropagation();
                        jumpToPage(targetSide, targetPage);
                    });
                    bookmarkItem.style.cursor = 'pointer';
                } else {
                    bookmarkItem.style.opacity = '0.6';
                    bookmarkItem.style.cursor = 'default';
                }
                
                bookmarkList.appendChild(bookmarkItem);
                
                if (item.items && item.items.length > 0) {
                    await processBookmarkItems(item.items, level + 1);
                }
            }
        }
        
        await processBookmarkItems(outline);
        bookmarkContainer.innerHTML = '';
        bookmarkContainer.appendChild(bookmarkList);
        
    } catch (e) {
        console.error('加载书签失败:', e);
        bookmarkContainer.innerHTML = '<div class="no-bookmarks">加载书签失败</div>';
    }
}

// 跳转到指定页面
function jumpToPage(side, pageNumber) {
    const panel = document.getElementById(`viewer-${side}`);
    const content = document.getElementById(`content-${side}`);
    const wrappers = content.querySelectorAll('.canvas-wrapper');
    
    if (pageNumber > 0 && pageNumber <= wrappers.length) {
        const targetWrapper = wrappers[pageNumber - 1];
        const scale = currentScale / 1.2;
        const scrollPosition = targetWrapper.offsetTop * scale;
        panel.scrollTop = scrollPosition;
    }
}

// 切换侧边栏标签页
function switchTab(side, tabName) {
    const tabs = document.querySelectorAll(`#sidebar-tabs-${side} .sidebar-tab`);
    tabs.forEach(tab => tab.classList.remove('active'));
    event.target.classList.add('active');
    
    const contents = document.querySelectorAll(`#sidebar-content-${side} .tab-content`);
    contents.forEach(content => content.classList.remove('active'));
    document.getElementById(`tab-${tabName}-${side}`).classList.add('active');
}

// 收起侧边栏
function collapseSidebar(side) {
    const sidebar = document.getElementById(`sidebar-${side}`);
    const toggleBtn = sidebar.querySelector('.sidebar-toggle');
    if (!sidebar.classList.contains('collapsed')) {
        sidebar.classList.add('collapsed');
        toggleBtn.textContent = side === 'left' ? '▶' : '◀';
    }
}

// 展开侧边栏
function expandSidebar(side) {
    const sidebar = document.getElementById(`sidebar-${side}`);
    const toggleBtn = sidebar.querySelector('.sidebar-toggle');
    if (sidebar.classList.contains('collapsed')) {
        sidebar.classList.remove('collapsed');
        toggleBtn.textContent = side === 'left' ? '◀' : '▶';
    }
}

// 搜索后自动展开侧边栏
function autoExpandSidebars() {
    if (searchResults.left && searchResults.left.length > 0) {
        expandSidebar('left');
    }
    if (searchResults.right && searchResults.right.length > 0) {
        expandSidebar('right');
    }
}

// 侧边栏收展
function toggleSidebar(side) {
    const sidebar = document.getElementById(`sidebar-${side}`);
    const toggleBtn = sidebar.querySelector('.sidebar-toggle');
    sidebar.classList.toggle('collapsed');
    
    if (sidebar.classList.contains('collapsed')) {
        toggleBtn.textContent = side === 'left' ? '▶' : '◀';
    } else {
        toggleBtn.textContent = side === 'left' ? '◀' : '▶';
    }
    
    // 延迟更新导航按钮位置，等待过渡动画完成
    setTimeout(updatePageNavPosition, 350);
}

// 搜索功能
async function performSearch() {
    const query = document.getElementById('search-input').value;
    if (!query) return;

    const caseSensitive = document.querySelector('.search-filter-item[data-value="case"]').classList.contains('selected');
    const wholeWord = document.querySelector('.search-filter-item[data-value="whole"]').classList.contains('selected');
    const useRegex = document.querySelector('.search-filter-item[data-value="regex"]').classList.contains('selected');

    searchResults = { left: [], right: [] };

    for (const side of ['left', 'right']) {
        if (!pdfDocuments[side]) continue;
        
        const results = [];
        const pdf = pdfDocuments[side];

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            
            let searchPattern;
            let flags = caseSensitive ? 'g' : 'gi';
            
            if (useRegex) {
                try {
                    searchPattern = new RegExp(query, flags);
                } catch (e) {
                    searchPattern = createSearchPattern(query, caseSensitive, wholeWord);
                }
            } else {
                searchPattern = createSearchPattern(query, caseSensitive, wholeWord);
            }
            
            let match;
            while ((match = searchPattern.exec(pageText)) !== null) {
                const start = Math.max(0, match.index - 30);
                const end = Math.min(pageText.length, match.index + query.length + 30);
                const snippet = pageText.substring(start, end);
                
                results.push({
                    pageNum: pageNum,
                    text: snippet,
                    matchIndex: match.index,
                    query: query
                });
            }
        }

        searchResults[side] = results;
        displaySearchResults(side, results);
    }

    highlightSearchResults(query);
    autoExpandSidebars();
}

// 显示搜索结果
function displaySearchResults(side, results) {
    const container = document.getElementById(`tab-search-${side}`);
    const stats = document.getElementById(`search-stats-${side}`);
    
    if (results.length === 0) {
        container.innerHTML = '<div class="no-results">未找到匹配结果</div>';
        stats.textContent = '';
        return;
    }

    container.innerHTML = '';
    results.forEach((result) => {
        const item = document.createElement('div');
        item.className = 'search-result-item';
        item.innerHTML = `
            <div class="search-result-page">第 ${result.pageNum} 页</div>
            <div class="search-result-text">...${escapeHtml(result.text)}...</div>
        `;
        item.onclick = () => jumpToResult(side, result);
        container.appendChild(item);
    });

    stats.textContent = `共 ${results.length} 个结果`;
}

// 创建搜索模式
function createSearchPattern(query, caseSensitive, wholeWord) {
    let pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    if (wholeWord) {
        pattern = '\\b' + pattern + '\\b';
    }
    
    let flags = caseSensitive ? 'g' : 'gi';
    return new RegExp(pattern, flags);
}

// 创建高亮模式
function createHighlightPattern(query, caseSensitive, wholeWord, useRegex) {
    let pattern;
    let flags = caseSensitive ? 'g' : 'gi';
    
    if (useRegex) {
        try {
            pattern = query;
        } catch (e) {
            pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }
    } else {
        pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    
    pattern = '\\b' + pattern + '\\b';
    
    return new RegExp(pattern, flags);
}

// 高亮搜索结果
function highlightSearchResults(query) {
    document.querySelectorAll('.text-layer .highlight').forEach(el => {
        el.classList.remove('highlight');
    });

    if (!query) return;

    const caseSensitive = document.querySelector('.search-filter-item[data-value="case"]').classList.contains('selected');
    const wholeWord = document.querySelector('.search-filter-item[data-value="whole"]').classList.contains('selected');
    const useRegex = document.querySelector('.search-filter-item[data-value="regex"]').classList.contains('selected');

    let highlightPattern;
    try {
        highlightPattern = createHighlightPattern(query, caseSensitive, wholeWord, useRegex);
    } catch (e) {
        return;
    }

    const textSpans = document.querySelectorAll('.text-layer span');
    
    textSpans.forEach(span => {
        if (highlightPattern.test(span.textContent)) {
            span.classList.add('highlight');
        }
        highlightPattern.lastIndex = 0;
    });
}

// 跳转到搜索结果
function jumpToResult(side, result) {
    const panel = document.getElementById(`viewer-${side}`);
    const content = document.getElementById(`content-${side}`);
    const wrappers = content.querySelectorAll('.canvas-wrapper');
    
    if (result.pageNum <= wrappers.length) {
        const targetWrapper = wrappers[result.pageNum - 1];
        panel.scrollTop = targetWrapper.offsetTop;
    }
}

// HTML 转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 切换过滤菜单显示
function toggleFilterMenu() {
    const menu = document.getElementById('search-filter-menu');
    menu.classList.toggle('show');
}

// 切换过滤选项
function toggleFilter(element) {
    element.classList.toggle('selected');
    updateFilterTags();
}

// 更新过滤标签显示
function updateFilterTags() {
    const tagsContainer = document.getElementById('filter-tags');
    const selectedItems = document.querySelectorAll('.search-filter-item.selected');
    const filterNames = {
        'case': 'Aa',
        'whole': '“”',
        'regex': '.*'
    };
    
    tagsContainer.innerHTML = '';
    selectedItems.forEach(item => {
        const value = item.getAttribute('data-value');
        const tag = document.createElement('span');
        tag.className = 'filter-tag';
        tag.textContent = filterNames[value];
        tagsContainer.appendChild(tag);
    });
}

// 启动应用
init();
