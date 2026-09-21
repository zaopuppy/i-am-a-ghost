import { CHARACTER_MODELS, type CharacterModelId, type CharacterKind } from '../assets/CharacterCatalog';
import { HOUSES, HOUSE_IDS, type HouseId } from './HouseCatalog';

/** The same floor plan is shown to solo players and everyone in a network room. */
export function createHousePicker(container: HTMLElement, choose: (id: HouseId) => void): (selected: HouseId, enabled: boolean) => void {
  const buttons = HOUSE_IDS.map((id) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'house-choice';
    card.dataset.houseChoice = id;
    card.innerHTML = `${housePreview(id)}<span class="house-choice__copy"><strong>${HOUSES[id].name}</strong><small>${HOUSES[id].hint}</small></span>`;
    card.addEventListener('click', () => choose(id));
    container.append(card);
    return card;
  });
  return (selected, enabled) => {
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(button.dataset.houseChoice === selected));
      button.disabled = !enabled;
    }
  };
}

export function createModelPicker(container: HTMLElement, choose: (id: CharacterModelId) => void):
  (kind: CharacterKind | null, selected: CharacterModelId | null, enabled: boolean) => void {
  const buttons = Object.entries(CHARACTER_MODELS).flatMap(([kind, entries]) =>
    Object.entries(entries).map(([id, info]) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `model-choice model-choice--${kind}`;
      card.dataset.modelChoice = id;
      card.dataset.modelKind = kind;
      const seal = document.createElement('span');
      seal.className = 'model-choice__seal';
      seal.textContent = kind === 'ghost' ? '鬼' : '孩';
      const label = document.createElement('strong');
      label.textContent = info.name;
      card.append(seal, label);
      card.addEventListener('click', () => choose(id as CharacterModelId));
      container.append(card);
      return card;
    }));
  return (kind, selected, enabled) => {
    for (const button of buttons) {
      button.hidden = button.dataset.modelKind !== kind;
      button.disabled = !enabled;
      button.setAttribute('aria-pressed', String(button.dataset.modelChoice === selected));
    }
  };
}

function housePreview(id: HouseId): string {
  const { bounds, walls, rooms, ghostSpawn, childSpawns } = HOUSES[id].scene.definition;
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  const floor = rooms.map((room) => `<rect x="${room.center.x - room.width / 2}" y="${-room.center.z - room.depth / 2}" width="${room.width}" height="${room.depth}" class="house-plan__${room.family}"/>`).join('');
  const partitions = walls.map((wall) => `<rect x="${wall.minX}" y="${-wall.maxZ}" width="${wall.maxX - wall.minX}" height="${wall.maxZ - wall.minZ}"/>`).join('');
  const children = childSpawns.map((spawn) => `<circle cx="${spawn.x}" cy="${-spawn.z}" r=".55" class="house-plan__child"/>`).join('');
  return `<svg class="house-plan" viewBox="${bounds.minX} ${-bounds.maxZ} ${width} ${depth}" role="img" aria-label="${HOUSES[id].name}俯视布局"><g class="house-plan__rooms">${floor}</g><g class="house-plan__walls">${partitions}</g>${children}<circle cx="${ghostSpawn.x}" cy="${-ghostSpawn.z}" r=".7" class="house-plan__ghost"/></svg>`;
}
