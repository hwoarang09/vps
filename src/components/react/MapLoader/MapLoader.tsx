import React from 'react';
import { useMenuStore } from '@/store/ui/menuStore';
import CFGLoader from './CFGLoader';

/**
 * MapLoader component - Map loading router based on active menu
 */
const MapLoader: React.FC = () => {
  const { activeMainMenu, activeSubMenu } = useMenuStore();

  // Only render when MapLoader is active
  if (activeMainMenu !== 'MapLoader') {
    return null;
  }

  // Route to appropriate loader based on submenu
  switch (activeSubMenu) {
    case 'maploader-menu-1': // CFG 파일 불러오기
      return <CFGLoader />;
    case 'maploader-menu-2': // Import (TODO)
      return null;
    case 'maploader-menu-3': // Export (TODO)
      return null;
    default:
      return null;
  }
};

export default MapLoader;
