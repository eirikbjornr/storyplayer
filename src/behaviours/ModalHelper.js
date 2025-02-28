// not a behaviour in itself, just helps, to keep BaseRenderer Clean

/* eslint-disable no-param-reassign */
const setDefinedPosition = (modalElement, behaviour) => {
    const { top, left, width, height, bottom, right } = behaviour.position;
    if (top !== undefined && top !== null) modalElement.style.top = `${top}%`;
    if (left !== undefined && left !== null) modalElement.style.left = `${left}%`;
    if (width !== undefined && width !== null) modalElement.style.width = `${width}%`;
    if (height !== undefined && height !== null) modalElement.style.height = `${height}%`;
    if (bottom !== undefined && bottom !== null) modalElement.style.bottom = `${bottom}%`;
    if (right !== undefined && right !== null) modalElement.style.right = `${right}%`;
};
/* eslint-enable no-param-reassign */

const createContainer = (target) => {
    let modalOverlay = document.getElementById('modal-container');
    if (!modalOverlay) {
        modalOverlay = document.createElement('div');
        modalOverlay.id = 'modal-container'
        modalOverlay.className = 'romper-modal-container';
        modalOverlay.setAttribute('role', 'alert');
        modalOverlay.setAttribute('aria-atomic', 'true');
        target.appendChild(modalOverlay);
    }
    return modalOverlay;
};

export { createContainer, setDefinedPosition };