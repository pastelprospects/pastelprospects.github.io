// Import THREE as a module
import * as THREE from '//unpkg.com/three/build/three.module.js';
window.THREE = THREE; // Shim for Globe.gl compatibility

import { cropData } from './crop_data.js';
import * as solar from 'https://esm.sh/solar-calculator';

const markerSvg = `<svg viewBox="-4 0 36 36">
<path fill="currentColor" d="M14,0 C21.732,0 28,5.641 28,12.6 C28,23.963 14,36 14,36 C14,36 0,24.064 0,12.6 C0,5.641 6.268,0 14,0 Z"></path>
<circle fill="black" cx="14" cy="14" r="7"></circle>
</svg>`;

// City data
// const cityData = [
//     { lat: 33.7501, lng: -84.3885, size: 25, color: 'orange', url: '/atlanta', label: 'Atlanta' },
// ...
// ];
const cityData = [];

let isCropOnlyMode = false;
let isNdviActive = false;
let hiddenCategories = new Set();

// Climate Layers Configuration
const CLIMATE_LAYERS = {
    'ndvi': {
        name: 'Vegetation (NDVI)',
        layer: 'MODIS_Terra_L3_NDVI_16Day',
        date: '2023-01-01',
        format: 'png',
        matrixSet: 'GoogleMapsCompatible_Level9',
        legend: [
            { color: '#003200', label: 'Dense Greenery' },
            { color: '#46b928', label: 'Healthy Crops' },
            { color: '#ffdd55', label: 'Sparse Vegetation' },
            { color: '#fffee1', label: 'Barrens / Stressed' }
        ]
    },
    'temp': {
        name: 'Land Surface Temp (Daily)',
        layer: 'MODIS_Terra_L3_Land_Surface_Temp_Daily_Day',
        date: '2023-01-01',
        format: 'png',
        matrixSet: 'GoogleMapsCompatible_Level7',
        legend: [
            { color: '#ff6600', label: '> 40°C' },
            { color: '#ffaa00', label: '25°C - 40°C' },
            { color: '#ffff00', label: '10°C - 25°C' },
            { color: '#0000ff', label: '< 10°C' }
        ]
    },
    'soil': {
        name: 'Soil Moisture',
        layer: 'SMAP_L4_Analyzed_Root_Zone_Soil_Moisture',
        date: '2023-01-01',
        format: 'png',
        matrixSet: 'GoogleMapsCompatible_Level6',
        legend: [
            { color: '#0000ff', label: 'High Moisture' },
            { color: '#00bfff', label: 'Moderate' },
            { color: '#ffaa00', label: 'Dry' },
            { color: '#ff6600', label: 'Very Dry' }
        ]
    },
    'precip': {
        name: 'Precipitation',
        layer: 'IMERG_Precipitation_Rate',
        date: '2023-01-01',
        format: 'png',
        matrixSet: 'GoogleMapsCompatible_Level6',
        legend: [
            { color: '#0000ff', label: 'Heavy Rain' },
            { color: '#00bfff', label: 'Moderate' },
            { color: '#e0ffff', label: 'Light' },
            { color: '#ffffff', label: 'None' }
        ]
    }
};

let currentClimateLayer = 'ndvi';

const CROP_GROUPS = {
    'Cereals & Grains': ['maize', 'wheat', 'rice', 'sorghum', 'millet', 'barley', 'rye'],
    'Legumes, Oilseeds & Pulses': ['soybean', 'sunflower', 'canola', 'groundnut', 'bean', 'alfalfa'],
    'Roots, Tubers & Sugar Crops': ['potato', 'sugarcane', 'sugarbeet', 'cassava', 'yam', 'carrot'],
    'Horticultural': ['orchard', 'fruit', 'tree', 'eggplant'],
    'Industrial & Beverage Crops': ['cotton', 'coffee', 'cocoa']
};

const GROUP_PRIMARY_COLORS = {
    'Cereals & Grains': { h: 0, s: 75, l: 50 },
    'Legumes, Oilseeds & Pulses': { h: 30, s: 85, l: 50 },
    'Roots, Tubers & Sugar Crops': { h: 50, s: 90, l: 50 },
    'Horticultural': { h: 280, s: 65, l: 45 },
    'Industrial & Beverage Crops': { h: 210, s: 80, l: 55 }
};

let expandedGroups = new Set();
let expandedModalGroups = new Set();
let cropColorShades = {};

const CROP_ALIASES = {
    'corn': 'maize',
    'dry bean': 'bean',
    'rapeseed': 'canola',
    'feverole': 'bean',
    'pois': 'bean',
    'cacao': 'cocoa'
};

const NON_CROP_COLOR = '#E57373';
const HIDDEN_COLOR = '#888888';

let isContinentMode = false;
const CONTINENT_COLORS = {
    'Africa': '#FF5722',
    'Asia': '#E91E63',
    'Europe': '#9C27B0',
    'North America': '#2196F3',
    'South America': '#4CAF50',
    'Oceania': '#FFEB3B',
    'Antarctica': '#00BCD4'
};

const CROP_ALL_KEYS = Object.values(CROP_GROUPS).flat();

function getCropType(d) {
    const labelLower = (d.label || '').toLowerCase();

    for (const [alias, canonical] of Object.entries(CROP_ALIASES)) {
        if (labelLower.includes(alias)) return canonical;
    }

    for (const crop of CROP_ALL_KEYS) {
        if (labelLower.includes(crop)) return crop;
    }
    return 'DEFAULT';
}

function getPointCategory(d) {
    if (isContinentMode && hiddenCategories.size === 0) {
        return d.continent || 'Unknown';
    }
    if (isContinentMode && hiddenCategories.size > 0) {
        const continent = d.continent || 'Unknown';
        if (hiddenCategories.has(continent)) {
            return continent;
        }
        if (!isCropOnlyMode) {
            return (d.color === NON_CROP_COLOR || (d.label && d.label.startsWith('Non-Crop'))) ? 'non-crop' : 'crop';
        }
        const type = getCropType(d);
        return type;
    }

    if (!isCropOnlyMode) {
        return (d.color === NON_CROP_COLOR || (d.label && d.label.startsWith('Non-Crop'))) ? 'non-crop' : 'crop';
    }
    const type = getCropType(d);
    return type;
}

function initCategoricalColors() {
    const counts = {};
    const totalData = cityData.concat(cropData);
    totalData.forEach(d => {
        if (d.color === NON_CROP_COLOR) return;
        const type = getCropType(d);
        counts[type] = (counts[type] || 0) + 1;
    });

    for (const [groupName, cropKeys] of Object.entries(CROP_GROUPS)) {
        const primary = GROUP_PRIMARY_COLORS[groupName];

        const presentKeys = cropKeys.filter(k => counts[k] > 0);
        presentKeys.sort((a, b) => counts[b] - counts[a]);

        presentKeys.forEach((key, index) => {
            const step = presentKeys.length > 1 ? (30 / (presentKeys.length - 1)) : 0;
            const lightness = 35 + (index * step);

            cropColorShades[key] = `hsl(${primary.h}, ${primary.s}%, ${lightness}%)`;
        });
    }

    cropColorShades['DEFAULT'] = `hsl(122, 47%, 49%)`;

    // Overrides
    cropColorShades['yam'] = 'hsl(60, 100%, 50%)'; // Yellow
    cropColorShades['cocoa'] = 'hsl(240, 100%, 50%)'; // Blue
}

function getMarkerColor(d) {
    // 1. Continent Coloring: Only if Continent Mode AND All Visible
    if (isContinentMode && hiddenCategories.size === 0) {
        return CONTINENT_COLORS[d.continent] || '#999999';
    }

    // 2. Standard Coloring (Landscape/Crop Monitor)
    if (!isCropOnlyMode) {
        return d.color;
    }

    const type = getCropType(d);
    let group = null;
    for (const [groupName, cropKeys] of Object.entries(CROP_GROUPS)) {
        if (cropKeys.includes(type)) {
            group = groupName;
            break;
        }
    }

    if (!group) return cropColorShades['DEFAULT'];

    if (expandedGroups.has(group)) {
        return cropColorShades[type] || cropColorShades['DEFAULT'];
    } else {
        const base = GROUP_PRIMARY_COLORS[group];
        return `hsl(${base.h}, ${base.s}%, ${base.l}%)`;
    }
}

function getGlobeData() {
    let data = cityData.concat(cropData);

    if (isCropOnlyMode || isNdviActive) {
        data = data.filter(d => d.color !== NON_CROP_COLOR && (!d.label || !d.label.startsWith('Non-Crop')));
    }

    data = data.filter(d => {
        const category = getPointCategory(d);
        return !hiddenCategories.has(category);
    });
    data = data.filter(d => {
        const category = getPointCategory(d);
        return !hiddenCategories.has(category);
    });

    return data.map(d => ({
        ...d,
        size: 5 + (Math.sqrt(d.density || 1) * 3.5),
        color: getMarkerColor(d),
        label: undefined
    }));
}

function getCropDisplayName(key) {
    if (key === 'DEFAULT') return 'Other';
    if (key === 'crop') return 'Crop';
    if (key === 'non-crop') return 'Non-Crop';
    return key.charAt(0).toUpperCase() + key.slice(1);
}

function toggleCategory(key) {
    if (hiddenCategories.has(key)) {
        hiddenCategories.delete(key);
    } else {
        hiddenCategories.add(key);
    }

    world.htmlElementsData(getGlobeData());
    updateLegend();
}

function updateLegend() {
    const tbody = document.getElementById('legendBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (isNdviActive) {
        // Dynamic Climate Legend
        const config = typeof CLIMATE_LAYERS !== 'undefined' ? CLIMATE_LAYERS[currentClimateLayer] : null;
        const legendItems = config ? config.legend : [];

        if (config) {
            // Use same styling as standard legend items
            legendItems.forEach(item => {
                const row = document.createElement('tr');
                row.className = 'legend-item-row';

                // Using the same structure as createEntry below
                row.innerHTML = `
                    <td style="display: flex; align-items: center; padding-left: 15px;">
                        <span class="legend-color-box" style="background-color: ${item.color}; opacity: 1;"></span>
                    </td>
                    <td style="padding-left: 15px;">
                        <div style="display: flex; align-items: center; justify-content: space-between; min-width: 0;">
                            <span style="color: #e0e0e0; font-size: 12px; white-space: normal; word-break: break-word; line-height: 1.2;">
                                ${item.label}
                            </span>
                        </div>
                    </td>
                `;
                tbody.appendChild(row);
            });
        }
        return;
    }

    const getAvailableCropTypes = () => {
        const available = new Set();
        let data = cityData.concat(cropData);

        if (isCropOnlyMode) {
            data = data.filter(d => d.color !== NON_CROP_COLOR);
        }
        if (isContinentMode && hiddenCategories.size > 0) {
            data = data.filter(d => {
                const continent = d.continent || 'Unknown';
                return !hiddenCategories.has(continent);
            });
        }

        data.forEach(d => {
            if (isCropOnlyMode) {
                const type = getCropType(d);
                available.add(type);
            } else {
                const category = (d.color === NON_CROP_COLOR || (d.label && d.label.startsWith('Non-Crop'))) ? 'non-crop' : 'crop';
                available.add(category);
            }
        });

        return available;
    };

    const availableCrops = (isContinentMode && hiddenCategories.size > 0) ? getAvailableCropTypes() : null;

    const createEntry = (key, color, name, isHeader = false, groupKeys = [], forceHeaderStyle = false) => {
        const isHidden = isHeader ?
            groupKeys.every(k => hiddenCategories.has(k)) :
            hiddenCategories.has(key);

        const isExpanded = isHeader && expandedGroups.has(key);
        const isUnavailable = !isHeader && availableCrops && !availableCrops.has(key);

        let displayColor = isHidden ? HIDDEN_COLOR : (isUnavailable ? HIDDEN_COLOR : color);
        const opacity = (isHidden || isUnavailable) ? '0.5' : '1';
        const textColor = (isHidden || isUnavailable) ? '#888' : (isHeader || forceHeaderStyle ? '#fff' : '#e0e0e0');

        const row = document.createElement('tr');
        row.className = (isHeader || forceHeaderStyle) ? 'legend-group-row' : 'legend-item-row';

        row.innerHTML = `
            <td style="display: flex; align-items: center;">
                <span class="legend-color-box ${isHeader || forceHeaderStyle ? 'header-box' : ''}" 
                      style="background-color: ${displayColor}; opacity: ${opacity}; ${isUnavailable ? 'cursor: not-allowed;' : ''}">
                </span>
            </td>
            <td style="padding-left: 0;">
                <div style="display: flex; align-items: center; justify-content: space-between; min-width: 0;">
                    <span style="color: ${textColor}; font-weight: ${isHeader || forceHeaderStyle ? 'bold' : 'normal'}; font-size: 12px; white-space: normal; word-break: break-word; line-height: 1.2;">
                        ${name}
                    </span>
                    ${isHeader ? `<span class="expand-toggle" style="margin-left: 8px; flex-shrink: 0; cursor: pointer; font-size: 10px;">${isExpanded ? '\u25B2' : '\u25BC'}</span>` : ''}
                </div>
            </td>
        `;

        if (isHeader) {
            const toggle = row.querySelector('.expand-toggle');
            toggle.onclick = (e) => {
                e.stopPropagation();
                toggleGroupExpansion(key);
            };

            const box = row.querySelector('.legend-color-box');
            box.onclick = () => toggleGroup(groupKeys);
        } else {
            const box = row.querySelector('.legend-color-box');
            if (!isUnavailable) {
                box.onclick = () => toggleCategory(key);
            }

            if (!forceHeaderStyle) {
                row.querySelector('td:first-child').style.paddingLeft = '15px';
                row.querySelector('td:last-child').style.paddingLeft = '15px';
            }
        }

        return row;
    };

    if (!isCropOnlyMode) {
        tbody.appendChild(createEntry('crop', '#4CAF50', 'Crop', false, [], true));
        tbody.appendChild(createEntry('non-crop', '#E57373', 'Non-Crop', false, [], true));
    } else {
        const { stats } = calculateCropStats();

        for (const [groupName, cropKeys] of Object.entries(CROP_GROUPS)) {
            const base = GROUP_PRIMARY_COLORS[groupName];
            const primaryColor = `hsl(${base.h}, ${base.s}%, ${base.l}%)`;

            tbody.appendChild(createEntry(groupName, primaryColor, groupName, true, cropKeys));

            if (expandedGroups.has(groupName)) {
                // Sort crops by frequency to match stats table
                const sortedKeys = [...cropKeys].sort((a, b) => (stats[b] || 0) - (stats[a] || 0));

                sortedKeys.forEach(key => {
                    const shade = cropColorShades[key] || cropColorShades['DEFAULT'];
                    tbody.appendChild(createEntry(key, shade, getCropDisplayName(key)));
                });
            }
        }

        if (cropColorShades['DEFAULT']) {
            tbody.appendChild(createEntry('DEFAULT', cropColorShades['DEFAULT'], 'Other / Unknown', false, [], true));
        }
    }
}

function toggleGroupExpansion(groupName) {
    if (expandedGroups.has(groupName)) {
        expandedGroups.delete(groupName);
    } else {
        expandedGroups.add(groupName);
    }

    world.htmlElementsData(getGlobeData());
    updateLegend();
}


function toggleGroup(keys) {
    const allHidden = keys.every(k => hiddenCategories.has(k));

    keys.forEach(k => {
        if (allHidden) {
            hiddenCategories.delete(k);
        } else {
            hiddenCategories.add(k);
        }
    });

    world.htmlElementsData(getGlobeData());
    updateLegend();
}


function calculateCropStats() {
    const stats = {};
    const groupStats = {};
    let totalCrops = 0;

    for (const key of Object.keys(cropColorShades)) {
        stats[key] = 0;
    }
    for (const group of Object.keys(CROP_GROUPS)) {
        groupStats[group] = 0;
    }

    const data = cityData.concat(cropData);

    data.forEach(d => {
        if (d.color === NON_CROP_COLOR) return;

        const category = getPointCategory(d);
        if (hiddenCategories.has(category)) return;

        totalCrops++;

        if (stats.hasOwnProperty(category)) {
            stats[category]++;

            for (const [groupName, cropKeys] of Object.entries(CROP_GROUPS)) {
                if (cropKeys.includes(category)) {
                    groupStats[groupName]++;
                    break;
                }
            }
        } else {
            stats['DEFAULT']++;
        }
    });

    return { stats, groupStats, total: totalCrops };
}

function calculateRegionalStats() {
    const regionalStats = {};
    let totalPoints = 0;

    // Initialize stats for each continent
    Object.keys(CONTINENT_COLORS).forEach(continent => {
        regionalStats[continent] = {
            total: 0,
            cropCount: 0,
            groups: {}
        };
        for (const group of Object.keys(CROP_GROUPS)) {
            regionalStats[continent].groups[group] = 0;
        }
        regionalStats[continent].groups['Other'] = 0;
    });
    regionalStats['Unknown'] = { total: 0, cropCount: 0, groups: {} }; // Handle edge cases

    const data = cityData.concat(cropData);

    data.forEach(d => {
        // Filter out hidden
        const pointCat = getPointCategory(d);
        if (hiddenCategories.has(pointCat)) return; // Logic check: if pointCat is 'crop'/'non-crop' (default mode) or 'maize' (crop mode), this handles modal filtering correctness? 
        // Actually, if we are in Continent Mode, filtering is by Continent usually. 
        // If hiddenCategories has 'Africa', then getPointCategory(d) returns 'Africa' (lines 80-87).
        // So this check is likely correct for consistency with the view.

        const continent = d.continent || 'Unknown';
        if (!regionalStats[continent]) {
            regionalStats[continent] = { total: 0, cropCount: 0, groups: {} }; // dynamic fallback
        }

        totalPoints++;
        regionalStats[continent].total++;

        // Check if crop (using same logic as getPointCategory fallback or direct check)
        const isCrop = !(d.color === NON_CROP_COLOR || (d.label && d.label.startsWith('Non-Crop')));

        if (isCrop) {
            regionalStats[continent].cropCount++;
            const type = getCropType(d);
            let foundGroup = false;

            for (const [groupName, cropKeys] of Object.entries(CROP_GROUPS)) {
                if (cropKeys.includes(type)) {
                    regionalStats[continent].groups[groupName] = (regionalStats[continent].groups[groupName] || 0) + 1;
                    foundGroup = true;
                    break;
                }
            }
            if (!foundGroup) {
                regionalStats[continent].groups['Other'] = (regionalStats[continent].groups['Other'] || 0) + 1;
            }
        }
    });

    return { regionalStats, total: totalPoints };
}

function updateModalContent() {
    const defaultView = document.getElementById('default-definitions');
    const statsView = document.getElementById('crop-statistics');
    const modalTitle = document.getElementById('modalTitle');
    if (!defaultView || !statsView || !modalTitle) return;

    // Clear previous event listeners by cloning
    const newStatsView = statsView.cloneNode(false);
    statsView.parentNode.replaceChild(newStatsView, statsView);
    const targetStatsView = newStatsView;

    // SCENARIO 1: Standard Landscape Mode (Not Crop Mode, Not Continent Mode) -> Show Definitions
    if (!isCropOnlyMode && !isContinentMode) {
        modalTitle.textContent = 'Data Definitions';
        defaultView.style.display = 'block';
        targetStatsView.style.display = 'none';
        return;
    }

    // SCENARIO 2: Continent Mode (and NOT Crop Mode) -> Show Regional Stats
    if (isContinentMode && !isCropOnlyMode) {
        modalTitle.textContent = 'Regional Distribution';
        defaultView.style.display = 'none';
        targetStatsView.style.display = 'block';

        const { regionalStats, total } = calculateRegionalStats();

        let html = `
        <table style="width: 100%; text-align: left; border-collapse: collapse; font-size: 13px;">
                <thead>
                    <tr style="border-bottom: 2px solid #555;">
                        <th style="padding: 10px 8px;">Region</th>
                        <th style="padding: 10px 8px; text-align: right;">% of Global Data</th>
                    </tr>
                </thead>
                <tbody>
        `;

        // Sort continents by count magnitude
        const sortedContinents = Object.entries(regionalStats)
            .sort((a, b) => b[1].total - a[1].total);

        for (const [continent, data] of sortedContinents) {
            if (data.total === 0) continue;

            const isExpanded = expandedModalGroups.has(continent);
            const globalPercent = ((data.total / total) * 100).toFixed(1);
            const color = CONTINENT_COLORS[continent] || '#999';

            html += `
                <tr class="modal-group-row" data-group="${continent}" style="background-color: rgba(255, 255, 255, 0.08); border-bottom: 1px solid #444; cursor: pointer;">
                    <td style="padding: 10px 8px; font-weight: bold; color: #fff; display: flex; align-items: center;">
                        <span style="display:inline-block; width: 12px; margin-right: 8px; font-size: 10px;">${isExpanded ? '▼' : '▶'}</span>
                        <span style="display:inline-block;width:10px;height:10px;background-color:${color};margin-right:8px;border-radius:50%;"></span>
                        ${continent}
                    </td>
                    <td style="padding: 10px 8px; text-align: right; font-weight: bold; color: #fff;">${globalPercent}%</td>
                </tr>
            `;

            if (isExpanded) {
                // Header for crop breakdown
                html += `
                    <tr style="background-color: rgba(0,0,0,0.2);">
                        <td colspan="2" style="padding: 5px 8px 5px 36px; font-size: 11px; text-transform: uppercase; color: #aaa; letter-spacing: 0.5px;">
                            Crop Group Breakdown (% of Region's Crops)
                        </td>
                    </tr>
                `;

                if (data.cropCount === 0) {
                    html += `
                        <tr style="border-bottom: 1px solid #333; background-color: rgba(255,255,255,0.02);">
                            <td colspan="2" style="padding: 6px 8px 6px 36px; color: #888; font-style: italic;">No crops found</td>
                        </tr>`;
                } else {
                    // Sort crop groups by count
                    const sortedGroups = Object.entries(data.groups)
                        .sort((a, b) => b[1] - a[1]);

                    for (const [groupName, count] of sortedGroups) {
                        if (count === 0) continue;
                        const groupPercent = ((count / data.cropCount) * 100).toFixed(1);
                        const base = GROUP_PRIMARY_COLORS[groupName];
                        const groupColor = base ? `hsl(${base.h}, ${base.s}%, ${base.l}%)` : (cropColorShades['DEFAULT'] || '#ccc');

                        html += `
                            <tr style="border-bottom: 1px solid #333; background-color: rgba(255,255,255,0.02);">
                                <td style="padding: 6px 8px 6px 36px; color: #ccc;">
                                    <span style="display:inline-block;width:8px;height:8px;background-color:${groupColor};margin-right:8px;border-radius:2px;"></span>
                                    ${groupName}
                                </td>
                                <td style="padding: 6px 8px; text-align: right; color: #ccc;">${groupPercent}%</td>
                            </tr>
                        `;
                    }
                }
            }
        }

        html += `</tbody></table>`;
        targetStatsView.innerHTML = html;
        attachRowListeners(targetStatsView);
        return;
    }

    // SCENARIO 3: Crop Mode (Global Stats)
    if (isCropOnlyMode) {
        modalTitle.textContent = 'Crop Statistics';
        defaultView.style.display = 'none';
        targetStatsView.style.display = 'block';

        const { stats, groupStats, total } = calculateCropStats();

        let html = `
        <table style="width: 100%; text-align: left; border-collapse: collapse; font-size: 13px;">
                <thead>
                    <tr style="border-bottom: 2px solid #555;">
                        <th style="padding: 10px 8px;">Classification / Crop</th>
                        <th style="padding: 10px 8px; text-align: right;">Percent</th>
                    </tr>
                </thead>
                <tbody>
        `;

        for (const [groupName, groupCount] of Object.entries(groupStats)) {
            if (groupCount === 0) continue;

            const isExpanded = expandedModalGroups.has(groupName);
            const groupPercent = ((groupCount / total) * 100).toFixed(1);

            html += `
                <tr class="modal-group-row" data-group="${groupName}" style="background-color: rgba(255, 255, 255, 0.08); border-bottom: 1px solid #444; cursor: pointer;">
                    <td style="padding: 10px 8px; font-weight: bold; color: #fff; display: flex; align-items: center;">
                        <span style="display:inline-block; width: 12px; margin-right: 8px; font-size: 10px;">${isExpanded ? '▼' : '▶'}</span>
                        ${groupName}
                    </td>
                    <td style="padding: 10px 8px; text-align: right; font-weight: bold; color: #fff;">${groupPercent}%</td>
                </tr>
            `;

            if (isExpanded) {
                const cropKeys = CROP_GROUPS[groupName];
                const sortedCrops = cropKeys
                    .filter(k => stats[k] > 0 || k === 'yam' || k === 'cocoa')
                    .sort((a, b) => (stats[b] || 0) - (stats[a] || 0));

                sortedCrops.forEach(key => {
                    const count = stats[key] || 0;
                    const percent = ((count / total) * 100).toFixed(1);
                    const color = cropColorShades[key] || cropColorShades['DEFAULT'];
                    const name = getCropDisplayName(key);

                    html += `
                        <tr style="border-bottom: 1px solid #333; background-color: rgba(255,255,255,0.02);">
                            <td style="padding: 6px 8px 6px 28px; color: #ccc;">
                                <span style="display:inline-block;width:8px;height:8px;background-color:${color};margin-right:8px;border-radius:2px;"></span>
                                ${name}
                            </td>
                            <td style="padding: 6px 8px; text-align: right; color: #ccc;">${percent}%</td>
                        </tr>
                    `;
                });
            }
        }

        if (stats['DEFAULT'] > 0) {
            const otherPercent = ((stats['DEFAULT'] / total) * 100).toFixed(1);
            html += `
                <tr style="background-color: rgba(255, 255, 255, 0.05); border-bottom: 1px solid #444;">
                    <td style="padding: 10px 8px; font-weight: bold; color: #fff;">Other / Unknown</td>
                    <td style="padding: 10px 8px; text-align: right; font-weight: bold; color: #fff;">${otherPercent}%</td>
                </tr>
            `;
        }

        targetStatsView.innerHTML = html;
        attachRowListeners(targetStatsView);
    }
}

function attachRowListeners(container) {
    container.querySelectorAll('.modal-group-row').forEach(row => {
        row.addEventListener('click', () => {
            const group = row.dataset.group;
            if (expandedModalGroups.has(group)) {
                expandedModalGroups.delete(group);
            } else {
                expandedModalGroups.add(group);
            }
            updateModalContent();
        });
    });
}

const dayNightShader = {
    vertexShader: `
        varying vec3 vNormal;
        varying vec2 vUv;
    void main() {
        vNormal = normalize(normalMatrix * normal);
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
    `,
    fragmentShader: `
    #define PI 3.141592653589793
        uniform sampler2D dayTexture;
        uniform sampler2D nightTexture;
        uniform vec2 sunPosition;
        uniform vec2 globeRotation;
        uniform int uMode; // 0: Dynamic, 1: Day, 2: Night
        varying vec3 vNormal;
        varying vec2 vUv;

        float toRad(in float a) {
        return a * PI / 180.0;
    }

        vec3 Polar2Cartesian(in vec2 c) { // [lng, lat]
            float theta = toRad(90.0 - c.x);
            float phi = toRad(90.0 - c.y);
        return vec3( // x,y,z
            sin(phi) * cos(theta),
            cos(phi),
            sin(phi) * sin(theta)
        );
    }

    void main() {
            float invLon = toRad(globeRotation.x);
            float invLat = -toRad(globeRotation.y);
            mat3 rotX = mat3(
        1, 0, 0,
        0, cos(invLat), -sin(invLat),
        0, sin(invLat), cos(invLat)
    );
            mat3 rotY = mat3(
        cos(invLon), 0, sin(invLon),
        0, 1, 0,
        -sin(invLon), 0, cos(invLon)
    );
            vec3 rotatedSunDirection = rotX * rotY * Polar2Cartesian(sunPosition);
            float intensity = dot(normalize(vNormal), normalize(rotatedSunDirection));
            vec4 dayColor = texture2D(dayTexture, vUv);
            vec4 nightColor = texture2D(nightTexture, vUv);
            
            float blendFactor;
            if (uMode == 1) {
                blendFactor = 1.0; // Force Day
            } else if (uMode == 2) {
                blendFactor = 0.0; // Force Night
            } else {
                blendFactor = smoothstep(-0.1, 0.1, intensity); // Dynamic
            }
            
        gl_FragColor = mix(nightColor, dayColor, blendFactor);
    }
    `
};

const sunPosAt = dt => {
    const day = new Date(+dt).setUTCHours(0, 0, 0, 0);
    const t = solar.century(dt);
    const longitude = (day - dt) / 864e5 * 360 - 180;
    return [longitude - solar.equationOfTime(t) / 4, solar.declination(t)];
};

// Wait for THREE and Globe to be loaded before initializing
function waitForLibs() {
    if (!window.Globe) {
        console.log(`Waiting for Globe...`);
        setTimeout(waitForLibs, 100);
        return;
    }
    console.log('Libraries loaded, initializing Globe...');
    initGlobe();
}

function initGlobe() {
    console.log('initGlobe started');
    initCategoricalColors();
    updateLegend();
    const world = window.Globe()(document.getElementById('globeViz'))
        .backgroundImageUrl('//cdn.jsdelivr.net/npm/three-globe/example/img/night-sky.png')
        .bumpImageUrl('//cdn.jsdelivr.net/npm/three-globe/example/img/earth-topology.png')
        .htmlElementsData(getGlobeData())
        .htmlElement(d => {
            const container = document.createElement('div');
            container.className = 'marker-container';

            const el = document.createElement('div');
            el.innerHTML = markerSvg;
            el.style.color = d.color;
            el.style.width = 'var(--marker-size)';
            el.style.height = 'var(--marker-size)';
            el.style['pointer-events'] = 'auto';
            el.style.cursor = 'pointer';

            if (d.url) {
                el.onclick = () => {
                    window.location.href = d.url;
                };
            } else {
                el.onclick = () => console.info("No URL associated with this marker", d);
            }

            container.appendChild(el);

            if (d.label) {
                const label = document.createElement('div');
                label.className = 'marker-label';
                label.textContent = d.label;
                container.appendChild(label);
            }

            return container;
        });


    Promise.all([
        new window.THREE.TextureLoader().loadAsync('//cdn.jsdelivr.net/npm/three-globe/example/img/earth-blue-marble.jpg'),
        new window.THREE.TextureLoader().loadAsync('//cdn.jsdelivr.net/npm/three-globe/example/img/earth-night.jpg')
    ]).then(([dayTexture, nightTexture]) => {
        console.log('Textures loaded');

        // --- Inner Globe for Climate Layer Stacking ---
        // Creates a second sphere slightly smaller than the main globe to show through when main globe is transparent
        const innerGlobeGeometry = new THREE.SphereGeometry(world.getGlobeRadius() * 0.995, 75, 75);
        const innerGlobeMaterial = new THREE.MeshPhongMaterial({
            map: dayTexture,
            color: 0xaaaaaa, // Slightly dimmed to not overpower data
            specular: 0x111111,
            shininess: 0
        });
        const innerGlobe = new THREE.Mesh(innerGlobeGeometry, innerGlobeMaterial);
        innerGlobe.visible = false; // Hidden by default
        world.scene().add(innerGlobe);

        // Expose to window for access in updateClimateLayer
        window.innerGlobe = innerGlobe;

        // --- 1. Material Setup (Unified Shader) ---
        const customMaterial = new window.THREE.ShaderMaterial({
            uniforms: {
                dayTexture: { value: dayTexture },
                nightTexture: { value: nightTexture },
                sunPosition: { value: new window.THREE.Vector2() },
                globeRotation: { value: new window.THREE.Vector2() },
                uMode: { value: 0 } // 0: Dynamic, 1: Day, 2: Night
            },
            vertexShader: dayNightShader.vertexShader,
            fragmentShader: dayNightShader.fragmentShader
        });

        // Initial State: Dynamic
        world.globeMaterial(customMaterial);

        // --- 2. State & Handlers ---
        let isRotationActive = true;
        let shaderState = 0;
        const shaderModes = [
            { name: 'Dynamic', icon: '🌍', value: 0 },
            { name: 'Day', icon: '☀️', value: 1 },
            { name: 'Night', icon: '🌙', value: 2 }
        ];

        world.onZoom((params) => {
            const { lng, lat, altitude } = params;

            // Update shader rotation uniform
            customMaterial.uniforms.globeRotation.value.set(lng, lat);

            const size = Math.max(6, Math.min(20, -5.6 * (altitude || 0.1) + 20));
            document.documentElement.style.setProperty('--marker-size', size + 'px');

            // Dynamic Rotation Speed
            const minAlt = 0.1;
            const maxAlt = 1.5;
            const minSpeed = 0.05;
            const maxSpeed = 0.5;

            const t = Math.min(1, Math.max(0, ((altitude || minAlt) - minAlt) / (maxAlt - minAlt)));
            const speed = minSpeed + t * (maxSpeed - minSpeed);

            if (isRotationActive) {
                world.controls().autoRotateSpeed = speed;
            }
        });

        // --- 3. Animation Loop ---
        let dt = +new Date();
        const VELOCITY = 1;

        requestAnimationFrame(() =>
            (function animate() {
                // Only advance time if rotation is active
                if (isRotationActive) {
                    dt += VELOCITY * 60 * 1000;
                }

                customMaterial.uniforms.sunPosition.value.set(...sunPosAt(dt));
                requestAnimationFrame(animate);
            })()
        );

        // --- 4. Control Panel Logic ---
        const rotateBtn = document.getElementById('rotateBtn');
        const shaderBtn = document.getElementById('shaderBtn');

        if (rotateBtn) {
            rotateBtn.classList.add('active'); // active by default
            rotateBtn.onclick = () => {
                isRotationActive = !isRotationActive;
                world.controls().autoRotate = isRotationActive;

                if (isRotationActive) {
                    rotateBtn.classList.add('active');
                    rotateBtn.innerHTML = '<span class="btn-icon">🔄</span> Rotate';
                } else {
                    rotateBtn.classList.remove('active');
                    rotateBtn.innerHTML = '<span class="btn-icon">⏸️</span> Paused';
                }
            };
        }

        if (shaderBtn) {
            shaderBtn.onclick = () => {
                shaderState = (shaderState + 1) % shaderModes.length;
                const mode = shaderModes[shaderState];

                customMaterial.uniforms.uMode.value = mode.value;
                shaderBtn.innerHTML = `<span class="btn-icon">${mode.icon}</span> ${mode.name}`;
            };
        }


        // Initialize Orbs
        const orbsContainer = document.getElementById('climateOrbs');
        const orbs = document.querySelectorAll('.climate-orb');

        orbs.forEach(orb => {
            orb.onclick = (e) => {
                e.stopPropagation();
                const layerKey = orb.dataset.layer;
                currentClimateLayer = layerKey;

                // Update UI
                orbs.forEach(o => o.classList.remove('active'));
                orb.classList.add('active');

                // Update Globe Layer
                updateClimateLayer();
            };
        });

        // Set initial active orb
        if (orbs.length > 0) orbs[0].classList.add('active');

        let zoomTimeout;

        function updateClimateLayer() {
            const config = CLIMATE_LAYERS[currentClimateLayer];
            if (!config) return;

            // Clear any pending zoom sequence
            if (zoomTimeout) clearTimeout(zoomTimeout);

            // Reset Zoom Constraints (allow full freedom by default)
            world.controls().maxDistance = Infinity;
            world.controls().minDistance = 101;

            // Extract Max Zoom Level from MatrixSet (e.g., "GoogleMapsCompatible_Level7" -> 7)
            const levelString = config.matrixSet || 'GoogleMapsCompatible_Level9';
            const maxZoom = parseInt(levelString.split('Level')[1]) || 9;

            world.globeTileEngineUrl((x, y, l) => {
                // Clamp zoom level to prevent 404s and keep layer visible
                const zoom = Math.min(l, maxZoom);
                return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${config.layer}/default/${config.date}/${levelString}/${zoom}/${y}/${x}.${config.format}`;
            });

            // --- Stacked Globe Mode ---
            // 1. Make Main Globe Transparent
            const globeMat = world.globeMaterial();
            if (globeMat) {
                globeMat.transparent = true;
                globeMat.opacity = 0.6; // Reduced to 0.6 for better visibility of land
                globeMat.needsUpdate = true;
            }

            // 2. Show Inner Globe (Background Texture)
            if (window.innerGlobe) {
                window.innerGlobe.visible = true;
                console.log("Inner Globe Activated");
            } else {
                console.warn("Inner Globe NOT FOUND");
            }

            // Auto-Zoom Logic
            const currentAlt = world.pointOfView().altitude;

            if (maxZoom <= 7) {
                // Low Res (Temp, Soil, Precip):
                // 1. Zoom OUT to Global View (2.5) first
                world.pointOfView({ altitude: 2.5 }, 1200);

                // 2. Zoom IN to viewable range (0.9)
                zoomTimeout = setTimeout(() => {
                    world.pointOfView({ altitude: 0.9 }, 1200);

                    // 3. LOCK Zoom Out at 0.9 (approx distance 190)
                    // Wait for zoom-in animation to finish (1200ms)
                    setTimeout(() => {
                        world.controls().maxDistance = 190;
                    }, 1250);

                }, 1300);

            } else {
                // High Res (NDVI): 
                // Target altitude 1.5.
                if (currentAlt > 2.1 || currentAlt < 1.9) {
                    world.pointOfView({ altitude: 2.0 }, 1200);
                }
            }

            // Update Legend
            updateLegend();
            updateLegendTitle();
        }

        const ndviBtn = document.getElementById('ndviBtn');
        const corsProxy = 'https://corsproxy.io/?';

        if (ndviBtn) {
            ndviBtn.onclick = () => {
                isNdviActive = !isNdviActive;

                if (isNdviActive) {
                    // Activate Climate Mode
                    updateClimateLayer();

                    ndviBtn.classList.add('active');
                    ndviBtn.innerHTML = '<span class="btn-icon">📡</span> Climate On';

                    // Show Orbs
                    if (orbsContainer) orbsContainer.style.display = 'flex';

                    // Dim markers to better see the raster
                    document.documentElement.style.setProperty('--marker-size', '4px');

                    // Disable Shader Button
                    if (shaderBtn) {
                        shaderBtn.style.opacity = '0.5';
                        shaderBtn.style.pointerEvents = 'none';
                        shaderBtn.innerHTML = '<span class="btn-icon">🚫</span> Disabled';
                    }
                } else {
                    // Deactivate Climate Mode
                    world.globeTileEngineUrl(null);

                    // Reset to Solid Globe
                    const globeMat = world.globeMaterial();
                    if (globeMat) {
                        globeMat.transparent = false;
                        globeMat.opacity = 1.0;
                    }
                    if (window.innerGlobe) {
                        window.innerGlobe.visible = false;
                    }

                    world.controls().maxDistance = Infinity; // Reset zoom cap

                    ndviBtn.classList.remove('active');
                    ndviBtn.innerHTML = '<span class="btn-icon">🌿</span> NDVI';

                    // Hide Orbs
                    if (orbsContainer) orbsContainer.style.display = 'none';

                    // Restore marker size
                    const altitude = world.pointOfView().altitude;
                    const size = Math.max(6, Math.min(20, -5.6 * (altitude || 0.1) + 20));
                    document.documentElement.style.setProperty('--marker-size', size + 'px');

                    // Re-enable Shader Button
                    if (shaderBtn) {
                        shaderBtn.style.opacity = '1';
                        shaderBtn.style.pointerEvents = 'auto';
                        const mode = shaderModes[shaderState];
                        shaderBtn.innerHTML = `<span class="btn-icon">${mode.icon}</span> ${mode.name}`;
                    }
                }
                world.htmlElementsData(getGlobeData());
                updateLegend();
                updateLegendTitle();
            };
        }
    });

    world.onZoom(({ altitude }) => {
        const size = Math.max(6, Math.min(20, -5.6 * (altitude || 0.1) + 20));
        document.documentElement.style.setProperty('--marker-size', size + 'px');
    });

    document.documentElement.style.setProperty('--marker-size', '6px');

    world.controls().autoRotate = true;
    world.controls().autoRotateSpeed = 0.5;

    const CLOUDS_IMG_URL = '/assets/img/scene/clouds.png';
    const CLOUDS_ALT = 0.005;
    const CLOUDS_ROTATION_SPEED = -0.007;

    new THREE.TextureLoader().load(CLOUDS_IMG_URL, cloudsTexture => {
        const clouds = new THREE.Mesh(
            new THREE.SphereGeometry(world.getGlobeRadius() * (1 + CLOUDS_ALT), 75, 75),
            new THREE.MeshPhongMaterial({ map: cloudsTexture, transparent: true, opacity: 0.35 })
        );
        world.scene().add(clouds);

        (function rotateClouds() {
            clouds.rotation.y += CLOUDS_ROTATION_SPEED * Math.PI / 180;
            requestAnimationFrame(rotateClouds);
        })();
    });

    const modal = document.getElementById("infoModal");
    const btn = document.getElementById("legendInfoBtn");
    const span = document.getElementsByClassName("close-button")[0];

    if (btn && modal && span) {
        btn.onclick = function () {
            updateModalContent();
            modal.style.display = "flex";
        }

        span.onclick = function () {
            modal.style.display = "none";
        }

        window.onclick = function (event) {
            if (event.target == modal) {
                modal.style.display = "none";
            }
        }
    }

    // Citation Modal Logic
    const citationModal = document.getElementById("citationModal");
    const citationBtn = document.getElementById("citationBtn");
    const citationCloseBtn = document.getElementById("citationCloseBtn");

    if (citationBtn && citationModal && citationCloseBtn) {
        citationBtn.onclick = function () {
            citationModal.style.display = "flex";
        }

        citationCloseBtn.onclick = function () {
            citationModal.style.display = "none";
        }

        // Add to window onclick if it exists, or create new one that handles both
        const existingOnClick = window.onclick;
        window.onclick = function (event) {
            if (existingOnClick) existingOnClick(event);

            if (event.target == citationModal) {
                citationModal.style.display = "none";
            }
        }
    }

    const filterBtn = document.getElementById('legendFilterBtn');

    function updateFilterButtonState() {
        if (!filterBtn) return;

        const shouldDisable = isContinentMode && hiddenCategories.size === 0;

        if (shouldDisable) {
            filterBtn.style.opacity = '0.3';
            filterBtn.style.cursor = 'not-allowed';
            filterBtn.style.pointerEvents = 'none';
        } else {
            filterBtn.style.opacity = '1';
            filterBtn.style.cursor = 'pointer';
            filterBtn.style.pointerEvents = 'auto';
        }
    }

    if (filterBtn) {
        filterBtn.onclick = () => {
            if (isContinentMode && hiddenCategories.size === 0) return;

            isCropOnlyMode = !isCropOnlyMode;
            world.htmlElementsData(getGlobeData());
            updateLegend();
            updateLegendTitle();
        };
    }
    let isLegendCollapsed = false;
    const legendToggleBtn = document.getElementById('legendToggleBtn');
    const legendTable = document.getElementById('legendTable');
    const legendTitleContent = document.getElementById('legendTitleContent');

    function updateLegendTitle() {
        if (legendTitleContent) {
            if (isNdviActive && typeof CLIMATE_LAYERS !== 'undefined') {
                const config = CLIMATE_LAYERS[currentClimateLayer];
                legendTitleContent.textContent = config ? config.name : 'Vegetation Health';
            } else {
                legendTitleContent.textContent = isCropOnlyMode ? 'Crop Monitor' : 'Landscape';
            }
        }
    }

    function updateLegendToggleState() {
        if (!legendToggleBtn) return;

        const shouldDisable = isContinentMode && hiddenCategories.size === 0;

        if (shouldDisable) {
            legendToggleBtn.style.opacity = '0.3';
            legendToggleBtn.style.cursor = 'not-allowed';
            legendToggleBtn.style.pointerEvents = 'none';
        } else {
            legendToggleBtn.style.opacity = '1';
            legendToggleBtn.style.cursor = 'pointer';
            legendToggleBtn.style.pointerEvents = 'auto';
        }
    }

    if (legendToggleBtn && legendTable && legendTitleContent) {
        legendToggleBtn.onclick = () => {
            if (isContinentMode && hiddenCategories.size === 0) return;

            isLegendCollapsed = !isLegendCollapsed;

            if (isLegendCollapsed) {
                legendTable.style.display = 'none';
                legendTitleContent.style.display = 'block';
                legendToggleBtn.textContent = '\u25B2';
                updateLegendTitle();
            } else {
                legendTable.style.display = 'table';
                legendTitleContent.style.display = 'none';
                legendToggleBtn.textContent = '\u25BC';
            }
        };
    }

    const continentBtn = document.getElementById('continentToggleBtn');
    const continentLegend = document.getElementById('continentLegend');
    const continentLegendBody = document.getElementById('continentLegendBody');
    const continentHeader = document.getElementById('continentLegendHeader');

    const CONTINENT_COORDS = {
        'Africa': { lat: 0, lng: 20, altitude: 2.0 },
        'Asia': { lat: 30, lng: 100, altitude: 2.0 },
        'Europe': { lat: 50, lng: 10, altitude: 2.0 },
        'North America': { lat: 40, lng: -100, altitude: 2.0 },
        'South America': { lat: -15, lng: -60, altitude: 2.0 },
        'Oceania': { lat: -25, lng: 135, altitude: 2.0 },
        'Antarctica': { lat: -90, lng: 0, altitude: 2.0 }
    };

    function toggleContinent(continentKey) {
        const allContinents = Object.keys(CONTINENT_COLORS);
        const isShowAll = hiddenCategories.size === 0;

        let targetContinent = continentKey;

        if (isShowAll) {
            allContinents.forEach(c => {
                if (c !== continentKey) hiddenCategories.add(c);
            });
        } else {
            if (hiddenCategories.has(continentKey)) {
                hiddenCategories.delete(continentKey);
                targetContinent = continentKey;
            } else {
                hiddenCategories.add(continentKey);
                targetContinent = null;
            }

            const visibleCount = allContinents.filter(c => !hiddenCategories.has(c)).length;
            if (visibleCount === 0) {
                hiddenCategories.clear();
                targetContinent = null;
            }
        }

        if (targetContinent) {
            world.controls().autoRotate = false;
            const coords = CONTINENT_COORDS[targetContinent];
            if (coords) {
                world.pointOfView(coords, 2000);
            }

            const mainLegend = document.getElementById('legendTable');
            if (mainLegend && legendTitleContent && legendToggleBtn) {
                isLegendCollapsed = false;
                mainLegend.style.display = 'table';
                legendTitleContent.style.display = 'none';
                legendToggleBtn.textContent = '\u25BC';
            }
            updateLegend();

        } else if (hiddenCategories.size === 0) {
            world.controls().autoRotate = true;
            const mainLegend = document.getElementById('legendTable');
            if (mainLegend) mainLegend.style.display = 'none';
            if (legendTitleContent) legendTitleContent.style.display = 'none';
        }

        world.htmlElementsData(getGlobeData());
        updateContinentLegend();
        updateFilterButtonState();
        updateLegendToggleState();
    }

    function updateContinentLegend() {
        if (!continentLegendBody) return;
        continentLegendBody.innerHTML = '';

        for (const [continent, color] of Object.entries(CONTINENT_COLORS)) {
            const isHidden = hiddenCategories.has(continent);
            const displayColor = isHidden ? HIDDEN_COLOR : color;
            const opacity = isHidden ? '0.5' : '1';

            const row = document.createElement('tr');
            row.innerHTML = `
        <span class="legend-color-box"
            style="margin: 15px; background-color: ${displayColor}; width: 12px; height: 12px; border-radius: 2px; opacity: ${opacity};">
        </span>
        <td style="font-size: 14px; color: ${isHidden ? '#888' : '#e0e0e0'}">${continent}</td>
    `;

            row.style.cursor = 'pointer';
            row.onclick = () => toggleContinent(continent);

            continentLegendBody.appendChild(row);
        }
    }

    if (continentBtn) {
        continentBtn.onclick = () => {
            isContinentMode = !isContinentMode;

            if (isContinentMode) {
                isCropOnlyMode = false;
                updateLegend();

                continentLegend.style.display = 'block';
                hiddenCategories.clear();
                updateContinentLegend();

                if (legendTable && legendTitleContent && legendToggleBtn) {
                    isLegendCollapsed = true;
                    legendTable.style.display = 'none';
                    legendTitleContent.style.display = 'block';
                    legendTitleContent.textContent = 'Continents';
                    legendToggleBtn.textContent = '\u25B2';
                }

                updateFilterButtonState();
                updateLegendToggleState();
            } else {
                continentLegend.style.display = 'none';

                if (legendTable && legendTitleContent && legendToggleBtn && isLegendCollapsed) {
                    isLegendCollapsed = false;
                    legendTable.style.display = 'table';
                    legendTitleContent.style.display = 'none';
                    legendToggleBtn.textContent = '\u25BC';
                }

                updateFilterButtonState();
                updateLegendToggleState();
            }

            world.htmlElementsData(getGlobeData());
        };
    }

    if (continentLegend && continentHeader) {
        let isDragging = false;
        let currentX;
        let currentY;
        let initialX;
        let initialY;
        let xOffset = 0;
        let yOffset = 0;

        continentHeader.onmousedown = dragStart;

        function dragStart(e) {
            initialX = e.clientX - xOffset;
            initialY = e.clientY - yOffset;

            if (e.target === continentHeader) {
                isDragging = true;
                document.onmouseup = dragEnd;
                document.onmousemove = drag;
            }
        }

        function dragEnd() {
            initialX = currentX;
            initialY = currentY;

            isDragging = false;
            document.onmouseup = null;
            document.onmousemove = null;
        }

        function drag(e) {
            if (isDragging) {
                e.preventDefault();
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;

                xOffset = currentX;
                yOffset = currentY;

                setTranslate(currentX, currentY, continentLegend);
            }
        }

        function setTranslate(xPos, yPos, el) {
            el.style.transform = `translate3d(${xPos}px, ${yPos}px, 0)`;
        }
    }

    const primaryLegend = document.querySelector('.legend');
    const legendDragBtn = document.getElementById('legendDragBtn');

    if (primaryLegend && legendDragBtn) {
        let isDragging = false;
        let currentX;
        let currentY;
        let initialX;
        let initialY;
        let xOffset = 0;
        let yOffset = 0;

        legendDragBtn.onmousedown = dragStart;

        function dragStart(e) {
            initialX = e.clientX - xOffset;
            initialY = e.clientY - yOffset;

            if (e.target === legendDragBtn) {
                isDragging = true;
                document.onmouseup = dragEnd;
                document.onmousemove = drag;
            }
        }

        function dragEnd() {
            initialX = currentX;
            initialY = currentY;

            isDragging = false;
            document.onmouseup = null;
            document.onmousemove = null;
        }

        function drag(e) {
            if (isDragging) {
                e.preventDefault();
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;

                xOffset = currentX;
                yOffset = currentY;

                setTranslate(currentX, currentY, primaryLegend);
            }
        }

        function setTranslate(xPos, yPos, el) {
            el.style.transform = `translate3d(${xPos}px, ${yPos}px, 0)`;
        }
    }
}



// Start the waiting process
waitForLibs();
