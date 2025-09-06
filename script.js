document.addEventListener('DOMContentLoaded', () => {
    const fileLoader = document.getElementById('file-loader');
    const graphContainer = document.getElementById('graph-container');
    const controlsPanel = document.getElementById('editor-controls');
    const infoBox = document.getElementById('info-box');
    const saveButton = document.getElementById('save-button');
    const savePngButton  = document.getElementById('save-png-button');
    const deleteButton   = document.getElementById('delete-button');
    const selectorDropdown = document.getElementById('selector-dropdown');
    const styleInputsContainer = document.getElementById('style-inputs');
    const toggleGrid           = document.getElementById('toggle-grid'); // ← новое

    /* ======== 0.  возврат к центру по клику колёсиком ======== */
    graphContainer.addEventListener('auxclick', e => {
        /* кнопка 1  === средняя (колёсико) */
        if (e.button === 1) {
            e.preventDefault();           // отменяем авто-скролл браузера
            if (cy) {
                cy.fit();                 // «приближаем» схему к границам контейнера
            }
        }
    });

    /* ======== 1.  отслеживаем Shift ======== */
    let isShiftPressed = false;
    window.addEventListener('keydown', e => { if (e.key === 'Shift') isShiftPressed = true; });
    window.addEventListener('keyup',   e => { if (e.key === 'Shift') isShiftPressed = false; });

    let cy, graphElements, graphStyle, graphLayout;
    let highlightAdded = false;              // ← новое

    const STYLE_PROPERTIES = {
        'node': {
            'background-color': 'color',
            'border-color': 'color',
            'border-width': 'number',
            'shape': ['rectangle', 'round-rectangle', 'ellipse', 'triangle', 'pentagon', 'hexagon', 'heptagon', 'octagon', 'star', 'barrel', 'diamond', 'vee', 'rhomboid', 'polygon'],
            'width': 'text', // can be number or 'data(w)'
            'height': 'text', // can be number or 'data(h)'
            'font-size': 'number',
            'font-weight': ['normal', 'bold'],
            'label': 'text'
        },
        'edge': {
            'line-color': 'color',
            'line-style': ['solid', 'dashed', 'dotted'],
            'width': 'number',
            'curve-style': ['bezier', 'straight', 'haystack', 'unbundled-bezier'],
            'target-arrow-shape': ['none', 'triangle', 'triangle-tee', 'circle-triangle', 'triangle-cross', 'triangle-backcurve', 'vee', 'tee', 'square', 'circle', 'diamond', 'none'],
            'target-arrow-color': 'color',
        }
    };

    fileLoader.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const htmlContent = e.target.result;
            try {
                parseAndRenderGraph(htmlContent);
                infoBox.classList.add('hidden');
                controlsPanel.classList.remove('hidden');
            } catch (error) {
                console.error("Ошибка при разборе файла:", error);
                alert("Не удалось разобрать файл. Убедитесь, что это корректный HTML-файл со схемой Cytoscape.");
            }
        };
        reader.readAsText(file);
    });

    function parseAndRenderGraph(htmlContent) {
        // Используем Function для безопасного парсинга объекта конфигурации из строки
        const configStrMatch = htmlContent.match(/cytoscape\s*\(\s*(\{[\s\S]*?\})\s*\)/);
        if (!configStrMatch) throw new Error("Конфигурация Cytoscape не найдена.");

        const configStr = configStrMatch[1];
        const getConfig = new Function(`return ${configStr}`);
        const config = getConfig();
        
        graphElements = config.elements;
        graphStyle = config.style;
        graphLayout = config.layout;

        if (cy) {
            cy.destroy();
        }

        cy = cytoscape({
            container: graphContainer,
            /*   блокируем box-selection, чтобы Shift использовался
                 исключительно для прилипания к сетке                */
            boxSelectionEnabled: false,
            elements: graphElements,
            style:    graphStyle,
            layout:   graphLayout
        });
        
        cy.ready(() => {
            populateControls();
            attachSnapToGrid();           // уже было
            setupElementEditing();          // ← новое
        });
    }
    
    function populateControls() {
        selectorDropdown.innerHTML = '';
        graphStyle.forEach((styleRule, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = styleRule.selector;
            selectorDropdown.appendChild(option);
        });

        // Добавляем возможность создавать новые селекторы
        const newOption = document.createElement('option');
        newOption.value = "new";
        newOption.textContent = "+ Добавить новый селектор";
        selectorDropdown.appendChild(newOption);

        selectorDropdown.dispatchEvent(new Event('change'));
    }
    
    selectorDropdown.addEventListener('change', () => {
        const selectedIndex = selectorDropdown.value;
        if (selectedIndex === "new") {
            const newSelector = prompt("Введите новый селектор (например, 'node.new-class' или 'edge:selected'):");
            if (newSelector) {
                graphStyle.push({ selector: newSelector, style: {} });
                populateControls();
                selectorDropdown.value = graphStyle.length - 1;
                selectorDropdown.dispatchEvent(new Event('change'));
            }
            return;
        }
        
        generateStyleInputs(selectedIndex);
    });

    function generateStyleInputs(styleIndex) {
        styleInputsContainer.innerHTML = '';
        const styleRule = graphStyle[styleIndex];
        const isEdge = styleRule.selector.startsWith('edge');
        const properties = STYLE_PROPERTIES[isEdge ? 'edge' : 'node'];

        for (const prop in properties) {
            const value = styleRule.style[prop] || '';
            const inputType = properties[prop];
            
            const group = document.createElement('div');
            group.className = 'style-input-group';

            const label = document.createElement('label');
            label.textContent = prop;
            group.appendChild(label);
            
            if (Array.isArray(inputType)) {
                const select = document.createElement('select');
                inputType.forEach(optionValue => {
                    const option = document.createElement('option');
                    option.value = optionValue;
                    option.textContent = optionValue;
                    if (optionValue === value) option.selected = true;
                    select.appendChild(option);
                });
                select.dataset.property = prop;
                select.addEventListener('change', updateStyle);
                group.appendChild(select);
            } else {
                const input = document.createElement('input');
                input.type = inputType;
                input.value = value;
                input.dataset.property = prop;
                input.addEventListener('input', updateStyle);
                group.appendChild(input);
            }
            styleInputsContainer.appendChild(group);
        }
    }
    
    function updateStyle(event) {
        const selectedIndex = selectorDropdown.value;
        const property = event.target.dataset.property;
        let value = event.target.value;

        if (event.target.type === 'number' && value) {
            value = parseFloat(value);
        }

        graphStyle[selectedIndex].style[property] = value;
        cy.style(graphStyle).update();
    }

    // ======== сохранение HTML ========
    saveButton.addEventListener('click', () => {
        if (!cy) return;

        /* убираем подсветку, чтобы рамка не влияла на стили */
        cy.nodes().removeClass('active-node');
        cy.edges().removeClass('active-edge');

        /* актуальные данные */
        const finalElementsStr = JSON.stringify(cy.json().elements, null, 2);
        const finalStyleStr    = JSON.stringify(graphStyle,           null, 2);

        /* вместо dagre → preset */
        const newHtmlContent = `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"></head>
<body>
  <div id="cy" style="width:100%;height:100vh;"></div>
  <script src="https://unpkg.com/cytoscape@3.27.0/dist/cytoscape.min.js"><\/script>
  <script>
    cytoscape({
      container : document.getElementById('cy'),
      elements  : ${finalElementsStr},
      layout    : { name : 'preset' },      /* ← фиксированные координаты */
      style     : ${finalStyleStr}
    }).ready(function(){ this.fit(); });
  <\/script>
</body></html>`;

        const blob = new Blob([newHtmlContent], { type: 'text/html' });
        const url  = URL.createObjectURL(blob);
        const a    = Object.assign(document.createElement('a'),
                    { href:url, download:'edited_scheme.html' });
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
    });

    /* ======== сохранение PNG ======== */
    savePngButton.addEventListener('click', () => {
        if (!cy) return;

        /* базовый PNG без рамки */
        const rawPng = cy.png({ full: true, scale: 2, bg: '#ffffff' });

        /* создаём новое полотно с +50 px по каждой стороне */
        const img = new Image();
        img.src = rawPng;
        img.onload = () => {
            const PAD = 250;    // 25-px, как и задумывалось
            const canvas = document.createElement('canvas');
            canvas.width  = img.width  + PAD * 2;
            canvas.height = img.height + PAD * 2;

            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';                          // фон рамки
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, PAD, PAD);                       // вставляем исходник

            canvas.toBlob(blob => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'scheme.png';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 'image/png');
        };
    });

    /* ======== 3.  Поузловое / по-стрелочное редактирование ======== */
    function setupElementEditing() {
        if (!cy) return;
        cy.off('tap', 'node edge');          // очищаем старые

        /* ---------- узел ---------- */
        cy.on('tap', 'node', evt => {
            const node = evt.target;
            const id   = node.id();
            /* --- создаём/выбираем правило --- */
            let idx = graphStyle.findIndex(r => r.selector === `node#${id}`);
            if (idx === -1) {
                const styleCopy = {};
                Object.keys(STYLE_PROPERTIES.node).forEach(p => {
                    styleCopy[p] = node.style(p);
                });
                graphStyle.push({ selector: `node#${id}`, style: styleCopy });
                idx = graphStyle.length - 1;
                populateControls();
            }

            selectorDropdown.value = idx;
            selectorDropdown.dispatchEvent(new Event('change'));

            /* --- подсветка --- */
            cy.nodes().removeClass('active-node');
            node.addClass('active-node');

            cy.edges().removeClass('active-edge');   // снимаем с рёбер
        });

        /* ---------- стрелка ---------- */
        cy.on('tap', 'edge', evt => {
            const edge = evt.target;
            const id   = edge.id();

            let idx = graphStyle.findIndex(r => r.selector === `edge#${id}`);
            if (idx === -1) {
                const styleCopy = {};
                Object.keys(STYLE_PROPERTIES.edge).forEach(p => {
                    styleCopy[p] = edge.style(p);
                });
                graphStyle.push({ selector: `edge#${id}`, style: styleCopy });
                idx = graphStyle.length - 1;
                populateControls();
            }

            selectorDropdown.value = idx;
            selectorDropdown.dispatchEvent(new Event('change'));

            cy.edges().removeClass('active-edge');
            edge.addClass('active-edge');

            cy.nodes().removeClass('active-node');   // снимаем с узлов
        });

        /* --- добавляем стили подсветки (один раз) --- */
        if (!highlightAdded) {
            graphStyle.push(
                { selector: 'node.active-node',
                  style: { 'border-width': 6, 'border-color': '#ff9800',
                           'overlay-opacity': 0.25, 'overlay-color':'#ffb74d' } },
                { selector: 'edge.active-edge',
                  style: { 'line-color': '#ff9800',
                           'target-arrow-color': '#ff9800',
                           'width': 6 } }
            );
            highlightAdded = true;
            cy.style(graphStyle).update();
        }
    }

    /* ======== 2.  функция прилипания ======== */
    function attachSnapToGrid() {
        if (!cy) return;
        cy.off('drag', 'node');           // избегаем дублирования при повторных загрузках
        cy.on('drag', 'node', evt => {
            if (!isShiftPressed) return;  // активируем только при Shift

            const node = evt.target;
            const pos  = node.position();

            const snappedX = Math.round(pos.x / GRID_SIZE) * GRID_SIZE;
            const snappedY = Math.round(pos.y / GRID_SIZE) * GRID_SIZE;

            node.position({ x: snappedX, y: snappedY });
        });
    }

    /* === настройка фоновой сетки === */
    const GRID_SIZE = 25;           // шаг сетки, px
    const gridCss   = `
        .grid-on{
            background-image:
              linear-gradient(to right , #e0e0e0 1px, transparent 1px),
              linear-gradient(to bottom, #e0e0e0 1px, transparent 1px);
            background-size:${GRID_SIZE}px ${GRID_SIZE}px;
        }`;
    const gridStyle = document.createElement('style');
    gridStyle.textContent = gridCss;
    document.head.appendChild(gridStyle);

    toggleGrid.addEventListener('change', () => {
        if (toggleGrid.checked) {
            graphContainer.classList.add('grid-on');
        } else {
            graphContainer.classList.remove('grid-on');
        }
    });

    // --- дублирующее объявление переменных удалено ---

    // --- обработчик удаления ---
    deleteButton.addEventListener('click', () => {
        if (!cy) return;

        const selNode = cy.nodes('.active-node');
        const selEdge = cy.edges('.active-edge');

        /* ---------- удаляем узел ---------- */
        if (selNode.nonempty()) {
            const n   = selNode[0];

            /* входящие и исходящие рёбра */
            const inEdges  = n.connectedEdges(`[target = "${n.id()}"]`);
            const outEdges = n.connectedEdges(`[source = "${n.id()}"]`);

            /* соединяем источники с целями */
            inEdges.sources().forEach(src => {
                outEdges.targets().forEach(dst => {
                    if (src.id() === dst.id()) return;          // пропускаем петлю
                    /* не дублируем уже существующее ребро */
                    if (cy.$(`edge[source = "${src.id()}"][target = "${dst.id()}"]`).length) return;

                    cy.add({
                        group : 'edges',
                        data  : {
                            id: `e${Date.now()}_${Math.random()}`,
                            source: src.id(),
                            target: dst.id(),
                            kind: 'norm'
                        }
                    });
                });
            });

            /* удаляем узел и инцидентные рёбра */
            n.connectedEdges().remove();
            n.remove();

        /* ---------- удаляем ребро ---------- */
        } else if (selEdge.nonempty()) {
            selEdge.remove();
        }

        /* снимаем подсветку и обновляем стиль/список */
        cy.nodes().removeClass('active-node');
        cy.edges().removeClass('active-edge');

        graphElements = cy.json().elements;   // чтобы дальнейшее сохранение было корректным
    });
}); 