
from PIL import Image
import numpy as np

def remove_color(
    input_path,
    output_path,
    target_color=(0, 255, 0),
    tolerance=40
):
    img = Image.open(input_path).convert("RGBA")
    data = np.array(img)

    rgb = data[:, :, :3].astype(np.int16)

    target = np.array(target_color, dtype=np.int16)

    # Hitung jarak warna RGB
    distance = np.sqrt(
        np.sum((rgb - target) ** 2, axis=2)
    )

    # Warna yang sesuai dijadikan transparan
    mask = distance <= tolerance

    data[mask, 3] = 0

    result = Image.fromarray(data)
    result.save(output_path, "PNG")

    print(f"Berhasil: {output_path}")


if __name__ == "__main__":
    remove_color(
        input_path="arum_mulut_a.png",
        output_path="arum_mulut_a_fix.png",
        target_color=(0, 255, 0),
        tolerance=40
    )

    remove_color(
        input_path="arum_mulut_e.png",
        output_path="arum_mulut_e_fix.png",
        target_color=(0, 255, 0),
        tolerance=40
    )

    remove_color(
        input_path="arum_mulut_i.png",
        output_path="arum_mulut_i_fix.png",
        target_color=(0, 255, 0),
        tolerance=40
    )

    remove_color(
        input_path="arum_mulut_o.png",
        output_path="arum_mulut_o_fix.png",
        target_color=(0, 255, 0),
        tolerance=40
    )

    remove_color(
        input_path="arum_mulut_u.png",
        output_path="arum_mulut_u_fix.png",
        target_color=(0, 255, 0),
        tolerance=40
    )
