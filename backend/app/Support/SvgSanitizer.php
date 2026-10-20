<?php

namespace App\Support;

use DOMDocument;
use DOMElement;
use DOMNode;
use RuntimeException;

/**
 * Allow-list SVG sanitiser for user uploads and AI output. SVG is code-like (scripts, event handlers, external loads),
 * so anything not explicitly allowed is removed and anything suspicious rejects the file.
 */
class SvgSanitizer
{
    public const MAX_BYTES = 300_000;

    private const ELEMENTS = ['svg', 'g', 'defs', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
        'lineargradient', 'radialgradient', 'stop', 'clippath', 'title', 'desc'];

    private const ATTRS = ['xmlns', 'version', 'viewbox', 'width', 'height', 'preserveaspectratio', 'id', 'class', 'transform',
        'd', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'fx', 'fy', 'points',
        'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray',
        'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule', 'clip-rule', 'clip-path',
        'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform', 'spreadmethod', 'clippathunits',
        'data-tint'];

    public const TINTS = ['skin', 'hair', 'top', 'bottom', 'hijab', 'tie', 'eye', 'shoe', 'accent'];

    /**
     * @return array{svg: string, width: int, height: int, tintable: bool}
     *
     * @throws RuntimeException user-facing message
     */
    public static function clean(string $raw): array
    {
        if (strlen($raw) > self::MAX_BYTES) {
            throw new RuntimeException('SVG terlalu besar (maks. '.(self::MAX_BYTES / 1000).' KB).');
        }
        if (preg_match('/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i', $raw)) {
            throw new RuntimeException('SVG tidak boleh memuat DOCTYPE/ENTITY.');
        }
        $raw = preg_replace('/^\s*<\?xml[^>]*\?>/i', '', trim($raw));

        $prev = libxml_use_internal_errors(true);
        $doc = new DOMDocument;
        $ok = $doc->loadXML($raw, LIBXML_NONET | LIBXML_NOBLANKS);
        libxml_clear_errors();
        libxml_use_internal_errors($prev);
        if (! $ok || ! $doc->documentElement || strtolower($doc->documentElement->localName) !== 'svg') {
            throw new RuntimeException('Bukan SVG yang valid.');
        }

        $root = $doc->documentElement;
        if (! preg_match('/^\s*0\s+0\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*$/', (string) $root->getAttribute('viewBox'), $m)) {
            throw new RuntimeException('SVG harus memiliki viewBox berformat "0 0 lebar tinggi".');
        }
        [$w, $h] = [(int) round((float) $m[1]), (int) round((float) $m[2])];
        if ($w < 8 || $h < 8 || $w > 4000 || $h > 4000) {
            throw new RuntimeException('Ukuran viewBox harus 8–4000.');
        }

        $count = 0;
        $tintable = false;
        self::walk($root, $count, $tintable);
        if ($count > 3000) {
            throw new RuntimeException('SVG terlalu kompleks (maks. 3000 elemen).');
        }
        $root->setAttribute('width', (string) $w);
        $root->setAttribute('height', (string) $h);
        $root->setAttribute('xmlns', 'http://www.w3.org/2000/svg');

        return ['svg' => $doc->saveXML($root), 'width' => $w, 'height' => $h, 'tintable' => $tintable];
    }

    private static function walk(DOMElement $el, int &$count, bool &$tintable): void
    {
        $count++;
        foreach (iterator_to_array($el->attributes) as $attr) {
            $name = strtolower($attr->nodeName);
            $val = $attr->nodeValue;
            if (str_starts_with($name, 'xmlns')) {
                $el->removeAttributeNode($attr);

                continue;
            }
            if (! in_array($name, self::ATTRS, true)) {
                $el->removeAttributeNode($attr); // event handlers (onclick...), href, style, ... are dropped

                continue;
            }
            // only local url(#id) references are allowed; no scripts, data/external URLs
            if (preg_match('/javascript:|data:|https?:|\/\/|expression\(|@import/i', $val) || (stripos($val, 'url(') !== false && ! preg_match('/^url\(#[\w-]+\)$/', trim($val)))) {
                throw new RuntimeException('Atribut "'.$name.'" berisi referensi yang tidak diizinkan.');
            }
            if ($name === 'data-tint') {
                if (! in_array($val, self::TINTS, true)) {
                    throw new RuntimeException('data-tint tidak dikenal: '.mb_substr($val, 0, 20));
                }
                $tintable = true;
            }
        }
        foreach (iterator_to_array($el->childNodes) as $child) {
            self::sanitizeChild($el, $child, $count, $tintable);
        }
    }

    private static function sanitizeChild(DOMElement $parent, DOMNode $child, int &$count, bool &$tintable): void
    {
        if ($child instanceof DOMElement) {
            if (! in_array(strtolower($child->localName), self::ELEMENTS, true)) {
                throw new RuntimeException('Elemen <'.$child->localName.'> tidak diizinkan (script, image, foreignObject, style, dll).');
            }
            self::walk($child, $count, $tintable);
        } elseif ($child->nodeType !== XML_TEXT_NODE && $child->nodeType !== XML_ELEMENT_NODE) {
            $parent->removeChild($child); // comments, CDATA, processing instructions
        }
    }
}
