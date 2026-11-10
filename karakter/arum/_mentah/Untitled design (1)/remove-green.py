
import cv2
import numpy as np
from PIL import Image

def remove_green_background(
    input_path,
    output_path,
    tolerance=65
):
    # Baca gambar
    img = Image.open(input_path).convert("RGBA")
    data = np.array(img)

    rgb = data[:, :, :3].astype(np.int16)
    height, width = rgb.shape[:2]

    # Ambil warna background dari sudut kiri atas
    target = rgb[0, 0]

    # Hitung kemiripan warna dengan background
    distance = np.sqrt(
        np.sum((rgb - target) ** 2, axis=2)
    )

    # Tandai piksel yang mirip background
    background_mask = (
        distance <= tolerance
    ).astype(np.uint8)

    # Cari area background yang terhubung
    # dengan pinggiran gambar
    num_labels, labels = cv2.connectedComponents(
        background_mask,
        connectivity=8
    )

    # Label yang menyentuh tepi gambar
    edge_labels = np.unique(np.concatenate([
        labels[0, :],
        labels[-1, :],
        labels[:, 0],
        labels[:, -1]
    ]))

    # Hapus hanya komponen yang menyentuh tepi
    remove_mask = np.isin(labels, edge_labels)
    remove_mask[labels == 0] = False

    # Jadikan transparan
    data[remove_mask, 3] = 0

    # Simpan PNG
    Image.fromarray(data).save(
        output_path,
        "PNG"
    )

    print("Background berhasil dihapus!")
    print("Warna target:", target)
    print("Tolerance:", tolerance)
    print("Output:", output_path)


if __name__ == "__main__":
    remove_green_background(
        "arum_mulut_u_fix.png",
        "arum_mulut_transparent.png",
        tolerance=65
    )



if __name__ == "__main__":
    remove_green_background(
        input_path="arum_mulut_a.png",
        output_path="arum_mulut_a_fix.png",
        tolerance=65
    )

    remove_green_background(
        input_path="arum_mulut_e.png",
        output_path="arum_mulut_e_fix.png",
        tolerance=65
    )

    remove_green_background(
        input_path="arum_mulut_i.png",
        output_path="arum_mulut_i_fix.png",
        tolerance=65
    )

    remove_green_background(
        input_path="arum_mulut_o.png",
        output_path="arum_mulut_o_fix.png",
        tolerance=65
    )

    remove_green_background(
        input_path="arum_mulut_u.png",
        output_path="arum_mulut_u_fix.png",
        tolerance=65
    )
