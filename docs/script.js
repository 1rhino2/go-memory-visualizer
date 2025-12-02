// Go Memory Visualizer - Interactive Features
(function() {
    'use strict';

    /**
     * VULN-020: Escape HTML attributes to prevent XSS
     */
    function escapeAttr(str) {
        if (typeof str !== 'string') return str;
        return str.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
    }

    // Type sizes for different architectures
    const TYPE_SIZES = {
        amd64: {
            bool: { size: 1, align: 1 },
            int8: { size: 1, align: 1 },
            uint8: { size: 1, align: 1 },
            byte: { size: 1, align: 1 },
            int16: { size: 2, align: 2 },
            uint16: { size: 2, align: 2 },
            int32: { size: 4, align: 4 },
            uint32: { size: 4, align: 4 },
            float32: { size: 4, align: 4 },
            rune: { size: 4, align: 4 },
            int: { size: 8, align: 8 },
            uint: { size: 8, align: 8 },
            int64: { size: 8, align: 8 },
            uint64: { size: 8, align: 8 },
            float64: { size: 8, align: 8 },
            uintptr: { size: 8, align: 8 },
            string: { size: 16, align: 8 },
            pointer: { size: 8, align: 8 },
            slice: { size: 24, align: 8 },
            interface: { size: 16, align: 8 },
            map: { size: 8, align: 8 },
            chan: { size: 8, align: 8 },
            func: { size: 8, align: 8 }
        },
        arm64: {
            bool: { size: 1, align: 1 },
            int8: { size: 1, align: 1 },
            uint8: { size: 1, align: 1 },
            byte: { size: 1, align: 1 },
            int16: { size: 2, align: 2 },
            uint16: { size: 2, align: 2 },
            int32: { size: 4, align: 4 },
            uint32: { size: 4, align: 4 },
            float32: { size: 4, align: 4 },
            rune: { size: 4, align: 4 },
            int: { size: 8, align: 8 },
            uint: { size: 8, align: 8 },
            int64: { size: 8, align: 8 },
            uint64: { size: 8, align: 8 },
            float64: { size: 8, align: 8 },
            uintptr: { size: 8, align: 8 },
            string: { size: 16, align: 8 },
            pointer: { size: 8, align: 8 },
            slice: { size: 24, align: 8 },
            interface: { size: 16, align: 8 },
            map: { size: 8, align: 8 },
            chan: { size: 8, align: 8 },
            func: { size: 8, align: 8 }
        },
        '386': {
            bool: { size: 1, align: 1 },
            int8: { size: 1, align: 1 },
            uint8: { size: 1, align: 1 },
            byte: { size: 1, align: 1 },
            int16: { size: 2, align: 2 },
            uint16: { size: 2, align: 2 },
            int32: { size: 4, align: 4 },
            uint32: { size: 4, align: 4 },
            float32: { size: 4, align: 4 },
            rune: { size: 4, align: 4 },
            int: { size: 4, align: 4 },
            uint: { size: 4, align: 4 },
            int64: { size: 8, align: 4 },
            uint64: { size: 8, align: 4 },
            float64: { size: 8, align: 4 },
            uintptr: { size: 4, align: 4 },
            string: { size: 8, align: 4 },
            pointer: { size: 4, align: 4 },
            slice: { size: 12, align: 4 },
            interface: { size: 8, align: 4 },
            map: { size: 4, align: 4 },
            chan: { size: 4, align: 4 },
            func: { size: 4, align: 4 }
        }
    };

    let currentArch = 'amd64';
    let fieldCounter = 0;

    // Calculate struct layout
    function calculateLayout(fields, arch) {
        const types = TYPE_SIZES[arch];
        let offset = 0;
        let maxAlign = 1;
        let dataBytes = 0;
        let paddingBytes = 0;
        const layout = [];

        for (const field of fields) {
            const typeInfo = types[field.type];
            if (!typeInfo) continue;

            const align = typeInfo.align;
            maxAlign = Math.max(maxAlign, align);

            const padding = (align - (offset % align)) % align;
            if (padding > 0) {
                layout.push({ type: 'padding', size: padding, offset: offset });
                paddingBytes += padding;
                offset += padding;
            }

            layout.push({ 
                type: 'field', 
                name: field.name, 
                fieldType: field.type,
                size: typeInfo.size, 
                offset: offset 
            });
            dataBytes += typeInfo.size;
            offset += typeInfo.size;
        }

        // Final padding for struct alignment
        if (maxAlign > 0) {
            const finalPadding = (maxAlign - (offset % maxAlign)) % maxAlign;
            if (finalPadding > 0) {
                layout.push({ type: 'padding', size: finalPadding, offset: offset });
                paddingBytes += finalPadding;
                offset += finalPadding;
            }
        }

        return {
            totalSize: offset,
            dataBytes,
            paddingBytes,
            maxAlign,
            layout
        };
    }

    // Calculate optimized layout (sort by alignment descending, then by size)
    function calculateOptimizedLayout(fields, arch) {
        const types = TYPE_SIZES[arch];
        const sortedFields = [...fields].sort((a, b) => {
            const typeA = types[a.type] || { align: 1, size: 1 };
            const typeB = types[b.type] || { align: 1, size: 1 };
            if (typeB.align !== typeA.align) return typeB.align - typeA.align;
            return typeB.size - typeA.size;
        });
        return calculateLayout(sortedFields, arch);
    }

    // Get fields from UI - only include fields with actual names
    function getFieldsFromUI() {
        const fields = [];
        document.querySelectorAll('.field-item').forEach((item, idx) => {
            const nameEl = item.querySelector('.field-name');
            const typeEl = item.querySelector('.field-type');
            if (!nameEl || !typeEl) return;
            
            const name = nameEl.value.trim();
            const type = typeEl.value;
            
            // Use field name if provided, otherwise generate one
            const fieldName = name || `field${idx + 1}`;
            fields.push({ name: fieldName, type });
        });
        return fields;
    }

    // Update calculator display
    function updateCalculator() {
        const fields = getFieldsFromUI();
        if (fields.length === 0) {
            resetCalculatorDisplay();
            return;
        }

        const current = calculateLayout(fields, currentArch);
        const optimized = calculateOptimizedLayout(fields, currentArch);

        // Update current size
        const currentSizeEl = document.getElementById('currentSize');
        if (currentSizeEl) {
            currentSizeEl.textContent = `${current.totalSize} bytes`;
        }

        // Update details
        const dataBytesEl = document.getElementById('dataBytes');
        const paddingBytesEl = document.getElementById('paddingBytes');
        const alignmentEl = document.getElementById('alignment');
        
        if (dataBytesEl) dataBytesEl.textContent = current.dataBytes;
        if (paddingBytesEl) paddingBytesEl.textContent = current.paddingBytes;
        if (alignmentEl) alignmentEl.textContent = current.maxAlign;

        // Update memory visualization (limit blocks for performance)
        const memViz = document.getElementById('memoryViz');
        if (memViz && current.totalSize > 0) {
            const maxBlocks = 50;
            let displayLayout = current.layout;
            
            if (displayLayout.length > maxBlocks) {
                // Consolidate for display
                displayLayout = consolidateLayout(current.layout, maxBlocks);
            }
            
            memViz.innerHTML = displayLayout.map(block => {
                const width = Math.max(0.5, (block.size / current.totalSize) * 100);
                const cls = block.type === 'padding' ? 'padding' : 'used';
                // VULN-020: Escape field names to prevent XSS in title attribute
                const title = block.type === 'padding' 
                    ? `padding (${block.size} bytes)` 
                    : `${escapeAttr(block.name)}: ${escapeAttr(block.fieldType)} (${block.size} bytes)`;
                return `<div class="mem-block ${cls}" style="width:${width}%" title="${title}"></div>`;
            }).join('');
        }

        // Update optimized result
        const optimizedResult = document.getElementById('optimizedResult');
        const optimizedSizeEl = document.getElementById('optimizedSize');
        const savingsFillEl = document.getElementById('savingsFill');
        const savingsTextEl = document.getElementById('savingsText');

        if (optimizedResult) {
            optimizedResult.style.display = 'block';
            const saved = current.totalSize - optimized.totalSize;
            
            if (saved > 0) {
                const percent = Math.round((saved / current.totalSize) * 100);
                if (optimizedSizeEl) {
                    optimizedSizeEl.textContent = `${optimized.totalSize} bytes (-${saved})`;
                }
                if (savingsFillEl) {
                    savingsFillEl.style.width = `${Math.min(100, percent * 2)}%`;
                }
                if (savingsTextEl) {
                    savingsTextEl.textContent = `Save ${saved} bytes (${percent}% reduction)`;
                }
            } else {
                if (optimizedSizeEl) optimizedSizeEl.textContent = `${optimized.totalSize} bytes`;
                if (savingsFillEl) savingsFillEl.style.width = '100%';
                if (savingsTextEl) savingsTextEl.textContent = 'Already optimal';
            }
        }
    }

    // Consolidate layout blocks for visualization when there are too many
    function consolidateLayout(layout, maxBlocks) {
        if (layout.length <= maxBlocks) return layout;
        
        const result = [];
        let currentBlock = null;
        
        for (const block of layout) {
            if (!currentBlock) {
                currentBlock = { ...block };
            } else if (currentBlock.type === block.type) {
                currentBlock.size += block.size;
                if (block.type === 'field') {
                    currentBlock.name = `${currentBlock.name}+`;
                }
            } else {
                result.push(currentBlock);
                currentBlock = { ...block };
            }
        }
        if (currentBlock) result.push(currentBlock);
        
        return result;
    }

    // Reset calculator display
    function resetCalculatorDisplay() {
        const currentSizeEl = document.getElementById('currentSize');
        const dataBytesEl = document.getElementById('dataBytes');
        const paddingBytesEl = document.getElementById('paddingBytes');
        const alignmentEl = document.getElementById('alignment');
        const memViz = document.getElementById('memoryViz');
        const optimizedResult = document.getElementById('optimizedResult');
        
        if (currentSizeEl) currentSizeEl.textContent = '0 bytes';
        if (dataBytesEl) dataBytesEl.textContent = '0';
        if (paddingBytesEl) paddingBytesEl.textContent = '0';
        if (alignmentEl) alignmentEl.textContent = '1';
        if (memViz) memViz.innerHTML = '<div class="mem-block used" style="width:100%;opacity:0.3" title="Add fields"></div>';
        if (optimizedResult) optimizedResult.style.display = 'none';
    }

    // Create field type options HTML
    function getFieldTypeOptions(selected = 'string') {
        const types = [
            { value: 'bool', label: 'bool' },
            { value: 'byte', label: 'byte' },
            { value: 'int8', label: 'int8' },
            { value: 'uint8', label: 'uint8' },
            { value: 'int16', label: 'int16' },
            { value: 'uint16', label: 'uint16' },
            { value: 'rune', label: 'rune' },
            { value: 'int32', label: 'int32' },
            { value: 'uint32', label: 'uint32' },
            { value: 'float32', label: 'float32' },
            { value: 'int', label: 'int' },
            { value: 'uint', label: 'uint' },
            { value: 'int64', label: 'int64' },
            { value: 'uint64', label: 'uint64' },
            { value: 'float64', label: 'float64' },
            { value: 'uintptr', label: 'uintptr' },
            { value: 'string', label: 'string' },
            { value: 'pointer', label: '*T' },
            { value: 'slice', label: '[]T' },
            { value: 'map', label: 'map' },
            { value: 'chan', label: 'chan' },
            { value: 'interface', label: 'interface{}' },
            { value: 'func', label: 'func' }
        ];
        return types.map(t => 
            `<option value="${t.value}"${t.value === selected ? ' selected' : ''}>${t.label}</option>`
        ).join('');
    }

    // Add field to calculator
    function addField(defaultType = 'string') {
        const fieldList = document.getElementById('fieldList');
        if (!fieldList) return;

        fieldCounter++;
        const fieldItem = document.createElement('div');
        fieldItem.className = 'field-item';
        fieldItem.innerHTML = `
            <input type="text" placeholder="field${fieldCounter}" class="field-name" value="">
            <select class="field-type">${getFieldTypeOptions(defaultType)}</select>
            <button class="remove-field" aria-label="Remove field">×</button>
        `;
        fieldList.appendChild(fieldItem);

        // Add event listeners
        const nameInput = fieldItem.querySelector('.field-name');
        const typeSelect = fieldItem.querySelector('.field-type');
        const removeBtn = fieldItem.querySelector('.remove-field');

        nameInput.addEventListener('input', updateCalculator);
        typeSelect.addEventListener('change', updateCalculator);
        removeBtn.addEventListener('click', function() {
            fieldItem.remove();
            updateCalculator();
        });

        updateCalculator();
        nameInput.focus();
    }

    // Clear all fields
    function clearAllFields() {
        const fieldList = document.getElementById('fieldList');
        if (fieldList) {
            fieldList.innerHTML = '';
            fieldCounter = 0;
            updateCalculator();
        }
    }

    // Initialize calculator
    function initCalculator() {
        const addBtn = document.getElementById('addFieldBtn');
        if (addBtn) {
            addBtn.addEventListener('click', () => addField('string'));
        }

        // Architecture toggle
        document.querySelectorAll('.arch-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                document.querySelectorAll('.arch-btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                currentArch = this.dataset.arch;
                updateCalculator();
            });
        });

        // Initial field listeners
        document.querySelectorAll('.field-item').forEach(item => {
            const nameInput = item.querySelector('.field-name');
            const typeSelect = item.querySelector('.field-type');
            const removeBtn = item.querySelector('.remove-field');

            if (nameInput) nameInput.addEventListener('input', updateCalculator);
            if (typeSelect) typeSelect.addEventListener('change', updateCalculator);
            if (removeBtn) {
                removeBtn.addEventListener('click', function() {
                    item.remove();
                    updateCalculator();
                });
            }
        });

        // Count existing fields
        fieldCounter = document.querySelectorAll('.field-item').length;
        
        updateCalculator();
    }

    // Mobile menu toggle
    function initMobileMenu() {
        const menuBtn = document.querySelector('.mobile-menu-btn');
        const navLinks = document.querySelector('.nav-links');
        
        if (menuBtn && navLinks) {
            menuBtn.addEventListener('click', function() {
                navLinks.classList.toggle('active');
                const expanded = navLinks.classList.contains('active');
                menuBtn.setAttribute('aria-expanded', expanded);
            });
        }
    }

    // Smooth scrolling
    function initSmoothScroll() {
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function(e) {
                const href = this.getAttribute('href');
                if (href === '#') return;
                
                e.preventDefault();
                const target = document.querySelector(href);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    
                    // Close mobile menu
                    const navLinks = document.querySelector('.nav-links');
                    if (navLinks) navLinks.classList.remove('active');
                }
            });
        });
    }

    // Intersection Observer for animations
    function initAnimations() {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        
        const observerOptions = {
            threshold: 0.1,
            rootMargin: '0px 0px -40px 0px'
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateY(0)';
                }
            });
        }, observerOptions);

        document.querySelectorAll('.feature-card, .doc-card, .benefit, .install-card, .faq-item').forEach(el => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(15px)';
            el.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
            observer.observe(el);
        });
    }

    // Copy code blocks
    function initCodeCopy() {
        document.querySelectorAll('.code-example pre, .install-card pre').forEach(pre => {
            if (pre.parentElement.classList.contains('code-copy-wrapper')) return;
            
            const wrapper = document.createElement('div');
            wrapper.className = 'code-copy-wrapper';
            wrapper.style.position = 'relative';
            pre.parentNode.insertBefore(wrapper, pre);
            wrapper.appendChild(pre);

            const button = document.createElement('button');
            button.textContent = 'Copy';
            button.setAttribute('aria-label', 'Copy code to clipboard');
            button.style.cssText = `
                position: absolute;
                top: 0.5rem;
                right: 0.5rem;
                padding: 0.25rem 0.6rem;
                background: rgba(0, 173, 216, 0.15);
                border: 1px solid rgba(0, 173, 216, 0.3);
                border-radius: 4px;
                color: #00ADD8;
                cursor: pointer;
                font-size: 0.75rem;
                opacity: 0;
                transition: opacity 0.2s;
            `;

            wrapper.appendChild(button);

            wrapper.addEventListener('mouseenter', () => button.style.opacity = '1');
            wrapper.addEventListener('mouseleave', () => button.style.opacity = '0');

            button.addEventListener('click', () => {
                const code = pre.textContent;
                navigator.clipboard.writeText(code).then(() => {
                    button.textContent = 'Copied!';
                    button.style.background = 'rgba(40, 167, 69, 0.15)';
                    button.style.borderColor = 'rgba(40, 167, 69, 0.3)';
                    button.style.color = '#28a745';
                    setTimeout(() => {
                        button.textContent = 'Copy';
                        button.style.background = 'rgba(0, 173, 216, 0.15)';
                        button.style.borderColor = 'rgba(0, 173, 216, 0.3)';
                        button.style.color = '#00ADD8';
                    }, 1500);
                });
            });
        });
    }

    // Navbar scroll effect
    function initNavbarScroll() {
        window.addEventListener('scroll', () => {
            const navbar = document.querySelector('.navbar');
            if (!navbar) return;
            
            const currentScroll = window.pageYOffset;
            navbar.style.background = currentScroll > 50 
                ? 'rgba(15, 15, 15, 0.98)' 
                : 'var(--darker-bg)';
        }, { passive: true });
    }

    // Initialize all features
    function init() {
        initCalculator();
        initMobileMenu();
        initSmoothScroll();
        initAnimations();
        initCodeCopy();
        initNavbarScroll();
    }

    // Run on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();