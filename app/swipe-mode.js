document.addEventListener('DOMContentLoaded', () => {
    // Получаем доступ к глобальным переменным из app.js
    // Убедитесь, что эти переменные доступны в глобальной области видимости в app.js
    const getGlobal = (name) => window.appGlobals?.[name];

    // --- DOM элементы ---
    const swipeOverlay = document.getElementById('swipe-mode-overlay');
    if (!swipeOverlay) return; // Если оверлея нет, ничего не делаем

    const swipeContainer = document.getElementById('swipe-container');
    const prevImage = document.getElementById('swipe-prev-image');
    const currentImage = document.getElementById('swipe-current-image');
    const nextImage = document.getElementById('swipe-next-image');
    const counterElement = document.getElementById('swipe-counter');
    const artistNameElement = document.getElementById('swipe-artist-name');

    const likeFeedbackElement = document.getElementById('swipe-like-feedback');
    const startSwipeBtn = document.getElementById('start-swipe-mode-btn');
    const favoritesCountElement = document.getElementById('swipe-favorites-count');
	const closeSwipeBtn = document.getElementById('swipe-close-btn');
    const swipeHideBtn = document.getElementById('swipe-hide-btn'); // <-- ДОБАВИТЬ ЭТУ СТРОКУ
	

    let currentIndex = -1;
    let activeList = [];
    let likeAnimationTimeout; // Переменная для хранения таймера анимации
    
    // Переменные для прокрутки колесиком мыши
    let lastWheelTime = 0;
    const WHEEL_COOLDOWN = 300; // Задержка в мс (регулируйте под себя, чтобы тачпад не листал слишком быстро)
    
    // --- Логика двунаправленной предзагрузки ---
    const PRELOAD_WINDOW = 15; // Сколько изображений грузить вперед и назад от текущего
    const PRELOAD_TRIGGER_OFFSET = 5; // За сколько изображений до края "окна" начинать новую загрузку
    let preloadedAheadIndex = -1; // Индекс, до которого предзагружено ВПЕРЕД
    let preloadedBehindIndex = -1; // Индекс, до которого предзагружено НАЗАД

    // --- Функции ---

    /**
     * Предзагружает следующую пачку изображений ВПЕРЕД.
     */
    function preloadAhead() {
        if (!activeList.length) return;
        const start = preloadedAheadIndex + 1;
        const end = Math.min(start + PRELOAD_WINDOW, activeList.length);
        for (let i = start; i < end; i++) {
            const img = new Image();
            img.src = activeList[i].image;
        }
        preloadedAheadIndex = end - 1;
    }
async function hideCurrentArtist() {
        if (currentIndex < 0 || currentIndex >= activeList.length) return;
        
        const currentArtist = activeList[currentIndex];
        const artistId = String(currentArtist.id);

        const db = getGlobal('db');
        const HIDDEN_STORE_NAME = getGlobal('HIDDEN_STORE_NAME');
        const hiddenItems = getGlobal('hiddenItems');
        const loadHiddenFromDB = getGlobal('loadHiddenFromDB');

        if (!db || !HIDDEN_STORE_NAME || !hiddenItems) {
            console.error("База данных или коллекция скрытых элементов недоступны из app.js.");
            return;
        }

        // ИСПРАВЛЕНО: Измеряем точные размеры И координаты смещения картинки внутри свайпа
        const hiddenOverlay = document.getElementById('swipe-hidden-overlay');
        if (currentImage && hiddenOverlay) {
            hiddenOverlay.style.width = `${currentImage.clientWidth}px`;
            hiddenOverlay.style.height = `${currentImage.clientHeight}px`;
            hiddenOverlay.style.top = `${currentImage.offsetTop}px`;
            hiddenOverlay.style.left = `${currentImage.offsetLeft}px`;
        }

        // Включаем анимацию большого креста (класс вешается на контейнер свайпа)
        if (swipeContainer) {
            swipeContainer.classList.add('is-hidden-animating');
        }

        try {
            // 1. Записываем автора в базу данных IndexedDB
            const transaction = db.transaction(HIDDEN_STORE_NAME, 'readwrite');
            const store = transaction.objectStore(HIDDEN_STORE_NAME);
            const timestamp = Date.now();
            
            store.put({ id: artistId, timestamp: timestamp });

            await new Promise((resolve, reject) => {
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
            });

            // 2. Синхронизируем локальный Map hiddenItems приложения
            hiddenItems.set(artistId, timestamp);
            if (typeof loadHiddenFromDB === 'function') {
                await loadHiddenFromDB();
            }

            // Даем вашей анимации креста красиво проиграться 300мс, затем переключаем карточку
            setTimeout(() => {
                if (swipeContainer) {
                    swipeContainer.classList.remove('is-hidden-animating');
                }

                // 3. Удаляем автора из текущего списка активного свайп-раунда
                activeList.splice(currentIndex, 1);

                // Если скрыли вообще последнего автора в списке — закрываем свайп
                if (activeList.length === 0) {
                    closeSwipeMode();
                } else {
                    // Корректируем индекс, если удалили элемент с конца списка
                    if (currentIndex >= activeList.length) {
                        currentIndex = activeList.length - 1;
                    }
                    
                    // Вызываем родную функцию обновления экрана из вашего swipe-mode.js
                    if (typeof updateSwipeView === 'function') {
                        updateSwipeView();
                    }
                }

                // 4. Перерисовываем главную галерею на фоне, чтобы этот автор сразу исчез с экрана
                const renderView = getGlobal('renderView');
                if (typeof renderView === 'function') {
                    renderView();
                }
            }, 300);

        } catch (error) {
            console.error("Ошибка при скрытии автора в Swipe Mode:", error);
            if (swipeContainer) {
                swipeContainer.classList.remove('is-hidden-animating');
            }
        }
    }
    /**
     * Предзагружает предыдущую пачку изображений НАЗАД.
     */
    function preloadBehind() {
        if (!activeList.length) return;
        const start = preloadedBehindIndex - 1;
        const end = Math.max(start - PRELOAD_WINDOW, -1);
        // Загружаем в обратном порядке, чтобы более близкие к текущему индексу грузились первыми
        for (let i = start; i > end; i--) {
            const img = new Image();
            img.src = activeList[i].image;
        }
        preloadedBehindIndex = end + 1;
    }

    /**
     * Открывает Swipe Mode для указанной карточки
     * @param {HTMLElement} cardElement - Карточка, на которую кликнули
     */
function openSwipeMode(cardElement) {
        const currentView = getGlobal('currentView');
        // Дополнительная проверка, чтобы полностью блокировать запуск в "Избранном"
        if (currentView === 'favorites') {
            return;
        }

        const artistId = cardElement?.dataset.id; // cardElement может быть null
        const allCurrentItems = getGlobal('currentItems');
        const favorites = getGlobal('favorites');
        const hiddenItems = getGlobal('hiddenItems'); // <-- ДОБАВЛЕНО
        const showToast = getGlobal('showToast');

        // Фильтруем список, исключая И избранных, И уже скрытых авторов
        activeList = allCurrentItems.filter(item => {
            const isFav = favorites ? favorites.has(item.id) : false;
            const isHidden = hiddenItems ? hiddenItems.has(String(item.id)) : false;
            return !isFav && !isHidden;
        });

        // Если карточек для просмотра 1 или меньше, режим не имеет смысла
        if (activeList.length <= 1) {
            if (showToast) {
                if (allCurrentItems.length > 1 && activeList.length === 0) {
                    showToast('All visible artists are already in favorites or hidden!');
                } else {
                    showToast('Not enough cards to start swipe mode.');
                }
            }
            return;
        }

        if (artistId) {
            const isClickedCardFavorite = favorites.has(artistId);
            if (isClickedCardFavorite) {
                // Если кликнули на карточку, которая уже в избранном,
                // ищем следующую доступную карточку в общем списке.
                const originalClickedIndex = allCurrentItems.findIndex(item => item.id === artistId);
                let nextAvailableItem = null;
                for (let i = originalClickedIndex + 1; i < allCurrentItems.length; i++) {
                    const currentId = allCurrentItems[i].id;
                    if (!favorites.has(currentId) && (!hiddenItems || !hiddenItems.has(String(currentId)))) {
                        nextAvailableItem = allCurrentItems[i];
                        break;
                    }
                }
                // Находим индекс этой следующей карточки в нашем отфильтрованном activeList.
                currentIndex = nextAvailableItem ? activeList.findIndex(item => item.id === nextAvailableItem.id) : 0;
                if (currentIndex === -1) currentIndex = 0;
            } else {
                // Если карточка доступна, просто находим ее индекс.
                currentIndex = activeList.findIndex(item => item.id === artistId);
                if (currentIndex === -1) currentIndex = 0;
            }
        } else {
            // Если cardElement не передан (клик по кнопке), начинаем с самого начала
            currentIndex = 0;
        }

        // Обновляем счетчик общего числа избранных при открытии
        if (favoritesCountElement) {
            favoritesCountElement.textContent = favorites ? favorites.size : 0;
        }
        document.body.style.overflow = 'hidden'; // Блокируем скролл основной страницы
        swipeOverlay.classList.add('visible');
        updateSwipeView();

        // Сбрасываем и запускаем двунаправленную предзагрузку
        preloadedAheadIndex = currentIndex - 1;
        preloadedBehindIndex = currentIndex + 1;
        preloadAhead();

        // Добавляем обработчики событий только когда режим активен
        document.addEventListener('keydown', handleSwipeKeyPress);
        // Добавляем слушатель колеса мыши к оверлею. passive: false позволяет использовать preventDefault()
        swipeOverlay.addEventListener('wheel', handleSwipeWheel, { passive: false });
    }

    /**
     * Закрывает Swipe Mode
     */
    function closeSwipeMode() {
        swipeOverlay.classList.remove('visible');
        document.body.style.overflow = ''; // Возвращаем скролл
        const updateVisibleFavorites = getGlobal('updateVisibleFavorites');
        if (updateVisibleFavorites) {
            // Обновляем состояние сердечек на видимых карточках в основной галерее
            updateVisibleFavorites();
        }
        // Удаляем обработчики, чтобы не мешать основной навигации
        document.removeEventListener('keydown', handleSwipeKeyPress);
        swipeOverlay.removeEventListener('wheel', handleSwipeWheel);
    }

    /**
     * Обновляет все элементы в оверлее на основе currentIndex
     */
function updateSwipeView() {
        if (currentIndex < 0 || currentIndex >= activeList.length) return;

        // ИСПРАВЛЕНО: Сбрасываем и размеры, и координаты оверлея перед загрузкой нового автора
        const hiddenOverlay = document.getElementById('swipe-hidden-overlay');
        if (hiddenOverlay) { 
            hiddenOverlay.style.width = ''; 
            hiddenOverlay.style.height = ''; 
            hiddenOverlay.style.top = ''; 
            hiddenOverlay.style.left = ''; 
        }

        const prevIndex = (currentIndex - 1 + activeList.length) % activeList.length;
        const nextIndex = (currentIndex + 1) % activeList.length;

        const currentItem = activeList[currentIndex];
        const prevItem = activeList[prevIndex];
        const nextItem = activeList[nextIndex];

        // Обновляем изображения
        currentImage.src = currentItem.image;
        prevImage.src = prevItem.image;
        nextImage.src = nextItem.image;

        // Обновляем счетчик и имя
        counterElement.textContent = `${currentIndex + 1} / ${activeList.length}`;
        artistNameElement.textContent = currentItem.artist;

        // Добавляем анимацию для плавной смены
        swipeContainer.classList.remove('swipe-transition');
        void swipeContainer.offsetWidth; // Трюк для сброса анимации
        swipeContainer.classList.add('swipe-transition');
    }

    /**
     * Переключает на следующее/предыдущее изображение
     * @param {number} direction - 1 для следующего, -1 для предыдущего
     */
    function navigate(direction) {
        if (!activeList.length) return;

        // Немедленно убираем анимацию лайка при навигации
        clearTimeout(likeAnimationTimeout);
        likeFeedbackElement.classList.remove('show');

        currentIndex = (currentIndex + direction + activeList.length) % activeList.length;
        updateSwipeView();

        // Проверяем, нужно ли подгрузить следующую пачку изображений
        if (direction > 0 && currentIndex + PRELOAD_TRIGGER_OFFSET >= preloadedAheadIndex) {
            preloadAhead();
        }
        // Проверяем, нужно ли подгрузить предыдущую пачку изображений
        // (учитываем цикличность списка)
        if (direction < 0 && (currentIndex - PRELOAD_TRIGGER_OFFSET <= preloadedBehindIndex || currentIndex > preloadedBehindIndex)) {
             preloadBehind();
        }
    }

    /**
     * Добавляет текущего артиста в избранное
     */
    function addToFavorites() {
        const db = getGlobal('db');
        const STORE_NAME = getGlobal('STORE_NAME');
        const favorites = getGlobal('favorites');
        const showToast = getGlobal('showToast');

        if (currentIndex === -1 || !db || !STORE_NAME || !favorites) return;

        const item = activeList[currentIndex];

        if (favorites.has(item.id)) {
            if (showToast) showToast('Already in favorites!');
            return;
        }

        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const favItem = { id: item.id, timestamp: Date.now() };
        store.put(favItem);

        transaction.oncomplete = () => {
            favorites.set(item.id, favItem.timestamp);
            if (showToast) showToast('Added to favorites');

            // Обновляем счетчик общего числа избранных
            if (favoritesCountElement) {
                favoritesCountElement.textContent = favorites.size;
            }
            // Добавляем визуальный фидбек (текст)
            artistNameElement.classList.add('favorited-feedback');
            setTimeout(() => artistNameElement.classList.remove('favorited-feedback'), 500);

            // Добавляем визуальный фидбек (сердце)
            clearTimeout(likeAnimationTimeout);
            likeFeedbackElement.classList.add('show');
            likeAnimationTimeout = setTimeout(() => likeFeedbackElement.classList.remove('show'), 600);
        };
    }

    /**
     * Обработчик нажатий клавиш в Swipe Mode
     * @param {KeyboardEvent} e
     */
function handleSwipeKeyPress(e) {
        // Используем e.code для независимости от раскладки клавиатуры
        switch (e.code) {
            case 'ArrowLeft':
                navigate(-1);
                break;
            case 'ArrowRight':
                navigate(1);
                break;
            case 'KeyC': // Физическая клавиша 'C'
                if (artistNameElement.textContent) {
                    navigator.clipboard.writeText('@' + artistNameElement.textContent).then(() => {
                        getGlobal('showToast')(`Artist name "@${artistNameElement.textContent}" copied!`);
                        // Добавляем подсветку имени как фидбек
                        artistNameElement.classList.add('copied-feedback');
                        setTimeout(() => {
                            artistNameElement.classList.remove('copied-feedback');
                        }, 500);
                    });
                }
                break;
            case 'ArrowDown':
                addToFavorites();
                break;
            
            // ИСПРАВЛЕНО: Скрытие автора перенесено на стрелку ВВЕРХ
            case 'ArrowUp':
                e.preventDefault(); // Предотвращаем стандартный скролл страницы браузером вверх
                hideCurrentArtist();
                break;

            case 'Escape':
                closeSwipeMode();
                break;
        }
    }

    /**
     * Обработчик прокрутки колесиком мыши в Swipe Mode
     * @param {WheelEvent} e
     */
    function handleSwipeWheel(e) {
        // Блокируем стандартное поведение прокрутки (хотя body уже locked, это полезно для тачпадов)
        e.preventDefault(); 

        const currentTime = Date.now();
        // Проверяем, прошло ли достаточно времени с последней прокрутки
        if (currentTime - lastWheelTime < WHEEL_COOLDOWN) {
            return;
        }

        if (e.deltaY > 0) {
            // Прокрутка вниз - следующее изображение
            navigate(1);
            lastWheelTime = currentTime;
        } else if (e.deltaY < 0) {
            // Прокрутка вверх - предыдущее изображение
            navigate(-1);
            lastWheelTime = currentTime;
        }
    }

    // --- Инициализация и глобальные привязки ---

    // Делегирование событий для клика колесиком мыши
    document.getElementById('gallery-container').addEventListener('mousedown', (e) => {
        // e.button === 1 это средняя кнопка мыши
        if (e.button === 1) {
            e.preventDefault(); 
            const card = e.target.closest('.card');
            if (!card) return;

            const currentView = getGlobal('currentView');
            const searchTerm = getGlobal('searchTerm');

            if (currentView === 'favorites') {
                // Новая логика: "Перейти к художнику в галерее"
                const artistId = card.dataset.id;
                // Устанавливаем флаг для app.js, чтобы он знал, куда прокрутить
                localStorage.setItem('jumpToArtistId', artistId);
                // Программно кликаем на вкладку галереи
                document.getElementById('tab-gallery').click();
            } else if (currentView === 'gallery' && (!searchTerm || searchTerm.length === 0)) {
                // Старая логика: запуск Swipe Mode из галереи
                // (блокируем, если активен поиск по имени)
                if (card) {
                    openSwipeMode(card);
                }
            }
        }
    });

    // Запуск по клику на новую кнопку
    if (startSwipeBtn) {
        startSwipeBtn.addEventListener('click', () => openSwipeMode(null));
    }

    // Закрытие по клику на кнопку
    closeSwipeBtn.addEventListener('click', closeSwipeMode);


    // Закрытие по клику на фон
    swipeOverlay.addEventListener('click', (e) => {
        if (e.target === swipeOverlay) {
            closeSwipeMode();
        }
    });

    // Экспортируем функцию открытия, чтобы ее можно было вызвать из app.js (если понадобится)
    window.appSwipe = {
        open: openSwipeMode
    };
});