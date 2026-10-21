// The world map file registers itself on a global, so expose the library before it loads.
import jsVectorMap from 'jsvectormap'

window.jsVectorMap = jsVectorMap
export default jsVectorMap
