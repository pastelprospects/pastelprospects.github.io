 // 3D Carousel functionality
class Carousel3D {
  constructor() {
    this.carousel = document.getElementById('carousel3d');
    this.items = this.carousel.querySelectorAll('.carousel-item-3d');
    this.prevBtn = document.getElementById('prevBtn');
    this.nextBtn = document.getElementById('nextBtn');
    this.indicators = document.querySelectorAll('.indicator');
    this.currentIndex = 0;
    this.totalItems = this.items.length;
    this.autoRotateInterval = null;
    this.autoRotateDelay = 6000;
    
    this.init();
  }
    
  init() {
    this.positionItems();
    this.bindEvents();
    this.updateIndicators();
    this.startAutoRotate();
  }
    
    positionItems() {
      const itemWidth = 320;
      
      this.items.forEach((item, index) => {
        // Calculate relative position from current active card
        let relativeIndex = index - this.currentIndex;
        
        // Handle infinite loop wrapping
        if (relativeIndex > 1) {
          relativeIndex = relativeIndex - this.totalItems;
        } else if (relativeIndex < -1) {
          relativeIndex = relativeIndex + this.totalItems;
        }
        
        // Calculate position based on relative index
        const itemWidth = 320;
        const spacing = 50; // Space between cards
        const x = relativeIndex * (itemWidth + spacing);
        
        // Only show 3 cards: previous, current, next
        if (Math.abs(relativeIndex) > 1) {
          item.style.display = 'none';
          item.classList.remove('active');
          return;
        } else {
          item.style.display = 'flex';
        }
        
        // Apply 3D effects based on position
        const z = -Math.abs(relativeIndex) * 50; // Depth effect
        const rotateY = relativeIndex * 15; // Rotation for side cards
        const scale = relativeIndex === 0 ? 1 : 0.85; // Active card is larger
        
        // Combine the base translate(-50%, -50%) with our 3D positioning
        item.style.transform = `translate(calc(-50% + ${x}px), -50%) translateZ(${z}px) rotateY(${rotateY}deg) scale(${scale})`;
        
        // Remove all existing state classes
        item.classList.remove('active', 'side-card', 'left', 'right');
        
        // Add appropriate state classes
        if (relativeIndex === 0) {
          item.classList.add('active');
        } else {
          item.classList.add('side-card');
          if (relativeIndex === -1) {
            item.classList.add('left');
          } else if (relativeIndex === 1) {
            item.classList.add('right');
          }
        }
      });
    }
    
  rotateCarousel(direction, isAutoRotate = false) {
    this.currentIndex = direction === 'next' 
      ? (this.currentIndex + 1) % this.totalItems
      : (this.currentIndex - 1 + this.totalItems) % this.totalItems;
    
    this.positionItems();
    this.updateIndicators();
    
    // Reset auto-rotate timer if user manually navigates
    if (!isAutoRotate) {
      this.resetAutoRotate();
    }
  }
    
    updateItemVisibility() {
      this.positionItems();
    }
    
    updateIndicators() {
      this.indicators.forEach((indicator, index) => {
        indicator.classList.toggle('active', index === this.currentIndex);
      });
    }
    
  goToSlide(index) {
    this.currentIndex = index;
    this.positionItems();
    this.updateIndicators();
    this.resetAutoRotate();
  }
  
  startAutoRotate() {
    this.stopAutoRotate(); // Clear any existing interval
    this.autoRotateInterval = setInterval(() => {
      this.rotateCarousel('next', true);
    }, this.autoRotateDelay);
  }
  
  stopAutoRotate() {
    if (this.autoRotateInterval) {
      clearInterval(this.autoRotateInterval);
      this.autoRotateInterval = null;
    }
  }
  
  resetAutoRotate() {
    this.stopAutoRotate();
    this.startAutoRotate();
  }
    
  bindEvents() {
    this.prevBtn.addEventListener('click', () => this.rotateCarousel('prev'));
    this.nextBtn.addEventListener('click', () => this.rotateCarousel('next'));
    
    this.indicators.forEach((indicator, index) => {
      indicator.addEventListener('click', () => this.goToSlide(index));
    });
    
    // Pause auto-rotate on hover
    this.carousel.addEventListener('mouseenter', () => this.stopAutoRotate());
    this.carousel.addEventListener('mouseleave', () => this.startAutoRotate());
      
      // Click on cards to navigate
      this.items.forEach((item, index) => {
        item.addEventListener('click', () => {
          let relativeIndex = index - this.currentIndex;
          
          // Handle infinite loop wrapping for click detection
          if (relativeIndex > 1) {
            relativeIndex = relativeIndex - this.totalItems;
          } else if (relativeIndex < -1) {
            relativeIndex = relativeIndex + this.totalItems;
          }
          
          if (relativeIndex === -1) {
            this.rotateCarousel('prev');
          } else if (relativeIndex === 1) {
            this.rotateCarousel('next');
          }
        });
      });
      
      // Keyboard navigation
      document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') this.rotateCarousel('prev');
        if (e.key === 'ArrowRight') this.rotateCarousel('next');
      });
      
      // Touch/swipe support
      let startX = 0;
      let startY = 0;
      
      this.carousel.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
      });
      
      this.carousel.addEventListener('touchend', (e) => {
        if (!startX || !startY) return;
        
        const endX = e.changedTouches[0].clientX;
        const endY = e.changedTouches[0].clientY;
        const diffX = startX - endX;
        const diffY = startY - endY;
        
        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
          if (diffX > 0) {
            this.rotateCarousel('next');
          } else {
            this.rotateCarousel('prev');
          }
        }
        
        startX = 0;
        startY = 0;
      });
    }
  }
  
  // Initialize carousel when DOM is loaded
  document.addEventListener('DOMContentLoaded', () => {
    new Carousel3D();
  });
